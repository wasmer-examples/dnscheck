# DnsCheck – Global DNS Propagation Checker

DnsCheck is a FastAPI application that lets you monitor DNS propagation across major public resolvers in real time. A Bulma-powered frontend streams live results over WebSockets, while a REST endpoint exposes the same data for automated integrations.

## Highlights

- **Live propagation tracking** – stream IPv4/IPv6 answers from multiple resolver lists via `/api/ws` WebSocket messages.
- **Resolver profiles** – curated provider lists (Google, Cloudflare, Quad9, OpenDNS, Yandex, etc.) selectable in the UI or API requests.
- **Transport control** – run lookups in automatic, UDP-only, or TCP-only mode to compare resolver behaviour.
- **Structured payloads** – Pydantic models ensure strongly-typed messages and consistent `{type, message}` error metadata.
- **REST access** – retrieve a full multi-provider snapshot with `GET /api/v1/dns-multicheck`.
- **Docs included** – interactive OpenAPI docs are available at `/docs` (linked from the landing page).

## Project Layout

```
src/
  main.py         # FastAPI app, resolver logic, WebSocket + REST endpoints
  tpl/index.html  # Bulma UI shell, embedded script placeholder
  tpl/code.js     # Frontend logic (WebSocket client, rendering, status handling)
```

## Running Locally

1. Install dependencies with [`uv`](https://github.com/astral-sh/uv):
   ```bash
   uv sync
   ```
2. Start the development server:
   ```bash
   uv run uvicorn src.main:app --reload
   ```
3. Open http://localhost:8000 to use the UI, or visit http://localhost:8000/docs for the auto-generated API docs.

## End-to-End Test

1. Ensure the FastAPI app is running locally (for example with `uv run uvicorn src.main:app --reload`).
2. Install the TestCafe dependency if you do not already have it available:
   ```bash
   npm install --save-dev testcafe
   ```
   You can also use `npx testcafe` without a local install.
3. Run the browser test against the live app:
   ```bash
   npx testcafe chrome tests/testcafe/dnscheck.test.js
   ```
   Set `TESTCAFE_BASE_URL` if the app is served from a different origin (defaults to `http://localhost:8000`).
   Or use the bundled helper which spins up the server automatically:
   ```bash
   make testcafe-native
   ```
   To iterate interactively or record new flows with TestCafe live mode (browser stays open for edits):
   ```bash
   make testcafe-record
   ```

## API Overview

### WebSocket – `/api/ws`

- **Initial message**: `provider_lists` (available resolver lists).
- **Request**: send `{ "action": "check", "domain": "example.com", "list_id": "global", "transport": "auto" }`.
- **Stream**: `run_started`, repeated `provider_result`, and a final `run_complete` payload. Errors are returned as `{ "type": "error", "message": "..." }`.

### REST – `GET /api/v1/dns-multicheck`

Query parameters:

| Name      | Type            | Default  | Description                             |
|-----------|-----------------|----------|-----------------------------------------|
| `domain`  | string (req.)   | –        | FQDN to resolve                         |
| `list_id` | string          | `global` | Resolver list ID                        |
| `transport` | `auto\|udp\|tcp` | `auto`   | Lookup transport mode                    |

Response body mirrors the `run_complete` WebSocket payload and includes consensus plus per-provider results.

## Development Notes

- DNS queries use [`dnspython`](https://github.com/rthalley/dnspython) with configurable transport and per-provider resolvers.
- Provider results include IPv4/IPv6 records, latency, and typed error details (`resolver_error`, `nxdomain`, etc.).
- The frontend highlights mismatches against consensus and keeps hard resolver errors prominent.

## Deploying to Wasmer Edge

Existing `make deploy-wasmer` and `make run-wasmer` targets remain available if you want to push to Wasmer Edge. See `Makefile` for details.
