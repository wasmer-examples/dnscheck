from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from collections import Counter
from enum import Enum
from typing import Dict, List, Literal, Optional

import dns.exception
import dns.resolver
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger("dnscheck")

app = FastAPI(title="DnsCheck")

DOMAIN_REGEX = re.compile(
    r"^(?=.{1,255}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$"
)

RecordType = Literal["A", "AAAA"]


class TransportMode(str, Enum):
    AUTO = "auto"
    UDP = "udp"
    TCP = "tcp"


class Provider(BaseModel):
    id: str
    name: str
    nameservers: List[str]


class ProviderList(BaseModel):
    id: str
    label: str
    description: str
    providers: List[Provider]


class ProviderListsMessage(BaseModel):
    type: Literal["provider_lists"] = "provider_lists"
    lists: Dict[str, ProviderList]


class RunStartedMessage(BaseModel):
    type: Literal["run_started"] = "run_started"
    domain: str
    list_id: str
    providers: List[str]
    transport: TransportMode


class DnsErrorInfo(BaseModel):
    type: str
    message: str


class ProviderResultPayload(BaseModel):
    records: Dict[RecordType, List[str]] = Field(default_factory=dict)
    errors: Dict[RecordType, Optional[DnsErrorInfo]] = Field(default_factory=dict)
    latency_ms: int
    provider: Provider


class ProviderResultMessage(BaseModel):
    type: Literal["provider_result"] = "provider_result"
    result: ProviderResultPayload
    consensus: Dict[RecordType, List[str]]


class RunCompleteMessage(BaseModel):
    type: Literal["run_complete"] = "run_complete"
    domain: str
    list_id: str
    consensus: Dict[RecordType, List[str]]
    providers: Dict[str, ProviderResultPayload]
    transport: TransportMode


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str


class IncomingMessage(BaseModel):
    action: str


class CheckRequest(IncomingMessage):
    action: Literal["check"]
    domain: str
    list_id: str = "global"
    transport: TransportMode = TransportMode.AUTO


class ListsRequest(IncomingMessage):
    action: Literal["lists"]


class MultiCheckResponse(BaseModel):
    domain: str
    list_id: str
    transport: TransportMode
    consensus: Dict[RecordType, List[str]]
    providers: Dict[str, ProviderResultPayload]


DNS_PROVIDER_LISTS: Dict[str, ProviderList] = {
    "global": ProviderList(
        id="global",
        label="Global Anycast Providers",
        description="Popular public DNS resolvers with worldwide presence.",
        providers=[
            Provider(
                id="google",
                name="Google Public DNS",
                nameservers=["8.8.8.8", "8.8.4.4"],
            ),
            Provider(
                id="cloudflare", name="Cloudflare", nameservers=["1.1.1.1", "1.0.0.1"]
            ),
            Provider(
                id="quad9", name="Quad9", nameservers=["9.9.9.9", "149.112.112.112"]
            ),
            Provider(
                id="opendns",
                name="Cisco OpenDNS",
                nameservers=["208.67.222.222", "208.67.220.220"],
            ),
            Provider(
                id="yandex",
                name="Yandex DNS",
                nameservers=[
                    "77.88.8.8",
                    "77.88.8.1",
                    "2a02:6b8::feed:0ff",
                    "2a02:6b8:0:1::feed:0ff",
                ],
            ),
        ],
    ),
    "privacy": ProviderList(
        id="privacy",
        label="Privacy Focused",
        description="Resolvers that emphasise privacy-first policies.",
        providers=[
            Provider(
                id="adguard",
                name="AdGuard DNS",
                nameservers=["94.140.14.14", "94.140.15.15"],
            ),
            Provider(
                id="nextdns",
                name="NextDNS",
                nameservers=["45.90.28.167", "45.90.30.167"],
            ),
            Provider(
                id="keweon",
                name="keweon",
                nameservers=["176.9.93.198", "176.9.137.253"],
            ),
        ],
    ),
}


def serialise_provider_lists() -> Dict[str, ProviderList]:
    return DNS_PROVIDER_LISTS


def load_html_template():
    """
    Load and build the index.html template.

    Reads the HTML and JS files, and injects the JS into the HTML.
    """
    try:
        base_dir = os.path.dirname(__file__)
        html_path = os.path.join(base_dir, "tpl/index.html")
        js_path = os.path.join(base_dir, "tpl/code.js")
        print(f"Loading HTML template from: {html_path}")
        with open(html_path, "r") as f:
            html = f.read()
        with open(js_path, "r") as f:
            js_code = f.read()

        # Replace placeholder with embedded JS code tag
        injected = html.replace(
            "<!-- JS_PLACEHOLDER -->", f"<script>\n{js_code}\n</script>"
        )
        return injected
    except Exception as e:
        print(f"Error loading HTML template: {e}")
        return "<!DOCTYPE html><html><body>ERROR: Could not load index.html template!</body></html>"


ROOT_HTML = load_html_template()


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root() -> str:
    return ROOT_HTML


async def resolve_records(
    domain: str,
    nameservers: List[str],
    record_type: str,
    transport: TransportMode,
) -> List[str]:
    """Resolve DNS records for a specific type using provided nameservers."""

    def _resolve() -> List[str]:
        resolver = dns.resolver.Resolver(configure=False)
        resolver.nameservers = nameservers
        resolver.lifetime = 4
        resolver.timeout = 2
        resolver.retry_servfail = True
        try:
            if transport is TransportMode.TCP:
                resolver.use_tcp = True
                answer = resolver.resolve(domain, record_type, tcp=True)
            elif transport is TransportMode.UDP:
                resolver.use_tcp = False
                answer = resolver.resolve(domain, record_type, tcp=False)
            else:
                answer = resolver.resolve(domain, record_type)
        except Exception as exc:  # pragma: no cover - handled by caller
            raise exc

        records: List[str] = []
        for item in answer:
            value = getattr(item, "address", str(item)).strip()
            records.append(value)
        # Deduplicate while preserving appearance order
        seen = set()
        ordered: List[str] = []
        for entry in records:
            if entry not in seen:
                seen.add(entry)
                ordered.append(entry)
        return sorted(ordered)

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _resolve)


def classify_dns_error(exc: Exception) -> DnsErrorInfo:
    if isinstance(exc, dns.resolver.NoAnswer):
        return DnsErrorInfo(type="no_answer", message="No answer for this record type.")
    if isinstance(exc, dns.resolver.NXDOMAIN):
        return DnsErrorInfo(
            type="nxdomain", message="Domain does not exist (NXDOMAIN)."
        )
    if isinstance(exc, dns.resolver.YXDOMAIN):
        return DnsErrorInfo(
            type="domain_error", message="Domain name is too long (YXDOMAIN)."
        )
    if isinstance(exc, dns.resolver.NoNameservers):
        return DnsErrorInfo(
            type="resolver_error", message="No usable nameservers returned a response."
        )
    if isinstance(exc, (dns.exception.Timeout, dns.resolver.LifetimeTimeout)):
        return DnsErrorInfo(type="resolver_error", message="Query timed out.")
    return DnsErrorInfo(type="resolver_error", message=str(exc))


def compute_consensus(
    results: Dict[str, ProviderResultPayload],
) -> Dict[RecordType, List[str]]:
    consensus: Dict[RecordType, List[str]] = {}
    for record_type in ("A", "AAAA"):
        sets: List[tuple[str, ...]] = []
        for provider_data in results.values():
            records = provider_data.records.get(record_type)
            if records:
                sets.append(tuple(records))
        if not sets:
            continue
        counter = Counter(sets)
        most_common = counter.most_common(1)[0][0]
        consensus[record_type] = list(most_common)
    return consensus


async def check_provider(
    domain: str,
    provider: Provider,
    transport: TransportMode,
) -> ProviderResultPayload:
    started_at = time.perf_counter()
    records: Dict[RecordType, List[str]] = {"A": [], "AAAA": []}
    errors: Dict[RecordType, Optional[DnsErrorInfo]] = {"A": None, "AAAA": None}

    tasks = {
        record_type: asyncio.create_task(
            resolve_records(domain, provider.nameservers, record_type, transport)
        )
        for record_type in ("A", "AAAA")
    }

    for record_type, task in tasks.items():
        try:
            records[record_type] = await task
        except Exception as exc:  # pragma: no cover - depends on DNS responses
            error_info = classify_dns_error(exc)
            if error_info.type == "resolver_error":
                logger.error(
                    "DNS lookup failed for %s (%s) via %s: %s",
                    domain,
                    record_type,
                    ",".join(provider.nameservers),
                    exc,
                    exc_info=exc,
                )
            errors[record_type] = error_info
            records[record_type] = []

    latency_ms = int((time.perf_counter() - started_at) * 1000)

    return ProviderResultPayload(
        records=records,
        errors=errors,
        latency_ms=latency_ms,
        provider=provider,
    )


async def run_dns_checks(
    domain: str,
    provider_list: ProviderList,
    websocket: WebSocket,
    transport: TransportMode,
) -> None:
    all_results: Dict[str, ProviderResultPayload] = {}

    await websocket.send_json(
        RunStartedMessage(
            domain=domain,
            list_id=provider_list.id,
            providers=[provider.id for provider in provider_list.providers],
            transport=transport,
        ).model_dump(mode="json")
    )

    for provider in provider_list.providers:
        provider_result = await check_provider(domain, provider, transport)

        all_results[provider.id] = provider_result

        await websocket.send_json(
            ProviderResultMessage(
                result=provider_result,
                consensus=compute_consensus(all_results),
            ).model_dump(mode="json")
        )

    await websocket.send_json(
        RunCompleteMessage(
            domain=domain,
            list_id=provider_list.id,
            consensus=compute_consensus(all_results),
            providers=all_results,
            transport=transport,
        ).model_dump(mode="json")
    )


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.send_json(
        ProviderListsMessage(lists=serialise_provider_lists()).model_dump(mode="json")
    )

    try:
        while True:
            data = await websocket.receive_json()
            try:
                base_message = IncomingMessage.model_validate(data)
            except ValidationError:
                await websocket.send_json(
                    ErrorMessage(message="Invalid message format received.").model_dump(
                        mode="json"
                    )
                )
                continue

            if base_message.action == "check":
                try:
                    payload = CheckRequest.model_validate(data)
                except ValidationError as exc:
                    await websocket.send_json(
                        ErrorMessage(
                            message="Invalid check request payload."
                        ).model_dump(mode="json")
                    )
                    continue

                domain = payload.domain.strip().lower()
                list_id = payload.list_id.strip()
                transport = payload.transport

                if not domain:
                    await websocket.send_json(
                        ErrorMessage(
                            message="Please enter a domain name to check."
                        ).model_dump(mode="json")
                    )
                    continue

                if not DOMAIN_REGEX.match(domain):
                    await websocket.send_json(
                        ErrorMessage(
                            message="Domain name looks invalid. Please try again."
                        ).model_dump(mode="json")
                    )
                    continue

                provider_list = DNS_PROVIDER_LISTS.get(list_id)
                if not provider_list:
                    await websocket.send_json(
                        ErrorMessage(
                            message="Unknown provider list selected."
                        ).model_dump(mode="json")
                    )
                    continue

                try:
                    await run_dns_checks(domain, provider_list, websocket, transport)
                except Exception as exc:  # pragma: no cover - unexpected runtime errors
                    await websocket.send_json(
                        ErrorMessage(
                            message=f"Unexpected error while checking DNS: {exc}",
                        ).model_dump(mode="json")
                    )

            elif base_message.action == "lists":
                await websocket.send_json(
                    ProviderListsMessage(lists=serialise_provider_lists()).model_dump(
                        mode="json"
                    )
                )
            else:
                await websocket.send_json(
                    ErrorMessage(message="Unknown action.").model_dump(mode="json")
                )
    except Exception:  # Connection closed or errored
        return


@app.get("/api/v1/dns-multicheck", response_model=MultiCheckResponse)
async def dns_multicheck(
    domain: str,
    list_id: str = "global",
    transport: TransportMode = TransportMode.AUTO,
) -> MultiCheckResponse:
    domain = domain.strip().lower()
    list_id = list_id.strip()

    if not domain:
        raise HTTPException(status_code=400, detail="Domain parameter is required.")

    if not DOMAIN_REGEX.match(domain):
        raise HTTPException(
            status_code=400, detail="Domain name looks invalid. Please try again."
        )

    provider_list = DNS_PROVIDER_LISTS.get(list_id)
    if not provider_list:
        raise HTTPException(status_code=404, detail="Unknown provider list selected.")

    providers: Dict[str, ProviderResultPayload] = {}
    for provider in provider_list.providers:
        providers[provider.id] = await check_provider(domain, provider, transport)

    consensus = compute_consensus(providers)

    return MultiCheckResponse(
        domain=domain,
        list_id=provider_list.id,
        transport=transport,
        consensus=consensus,
        providers=providers,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
