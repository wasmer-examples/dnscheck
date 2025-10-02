# Agent Guide: DnsCheck

This document briefs AI coding agents on the structure, conventions, and expectations for the DnsCheck project.

## Quick Facts

- **Framework**: FastAPI (Python 3.10+)
- **Frontend**: Bulma-styled HTML template with plain JS (`src/tpl/code.js`)
- **DNS**: [`dnspython`](https://github.com/rthalley/dnspython)
- **Data models**: Pydantic v2 (`BaseModel`, `model_dump`) for every payload exchanged inside the app and over the WebSocket/REST APIs.
- **Transport modes**: `auto`, `udp`, `tcp`

## Architecture Overview

```
src/
  main.py         # FastAPI app, provider definitions, WebSocket + REST routes, DNS logic
  tpl/index.html  # Bulma markup; `<script>` placeholder populated by load_html_template()
  tpl/code.js     # Frontend client: WebSocket lifecycle, UI rendering, consensus highlighting
```

### Backend (`src/main.py`)

- All provider metadata lives in `DNS_PROVIDER_LISTS` as `ProviderList` Pydantic models.
- WebSocket endpoint `/api/ws` streams typed messages:
  - `provider_lists`, `run_started`, `provider_result`, `run_complete`, `error`.
  - Incoming messages validated with `CheckRequest` / `ListsRequest` models; reject untyped payloads.
- REST endpoint `GET /api/v1/dns-multicheck` returns a snapshot equivalent to `run_complete`.
- DNS lookups occur via `check_provider()` → `resolve_records()` using dnspython; set resolver transport based on `TransportMode`.
- Errors classified with `classify_dns_error()` producing `DnsErrorInfo` (`resolver_error`, `nxdomain`, `no_answer`, etc.) and logged for resolver failures.

### Frontend (`src/tpl`)

- `index.html` is rendered once and embeds `code.js` via `load_html_template()`.
- `code.js` handles WebSocket reconnects, transport selector, provider list population, consensus highlighting, and status bar visibility rules (hidden when connected/idle, shown only on failure).
- The table expects `errors[type]` to be either `null` or `{ type, message }` matching backend models.

## Coding Guidelines

- **Always** define/extend Pydantic models when changing payload structures. Keep WebSocket and REST responses aligned.
- Preserve transport behaviour (`auto` falls back to TCP automatically) when altering resolver logic.
- Log resolver errors with context (domain, record type, nameservers) to aid debugging.
- Frontend updates should respect existing Bulma classes and avoid external build tooling; stick to vanilla JS.
- Keep the connection status banner hidden during normal operation; only surface it on failures.

## Testing & Tooling

- The repository uses `uv` for environment and task execution (`uv sync`, `uv run ...`).
- There is no dedicated test suite yet; when adding one, prefer `uv run pytest` for consistency.
- `uv run python -m compileall src` is used as a lightweight sanity check during automation.

## Common Tasks

- **Add providers**: extend `DNS_PROVIDER_LISTS` with new `Provider` entries; update UI copy if necessary.
- **Adjust payloads**: modify the relevant Pydantic model(s) and ensure the frontend parser is updated to match.
- **Extend REST API**: consider reusing existing helpers (`check_provider`, `compute_consensus`) to maintain parity between REST and WebSocket flows.
- **UI changes**: edit `tpl/index.html` and/or `tpl/code.js`; remember the HTML is embedded at runtime by `load_html_template()`.

## Deploy Notes

- `Makefile` targets (`make run-wasmer`, `make deploy-wasmer`) support Wasmer Edge deployments; review those scripts before changing runtime expectations.
- The FastAPI title is set to `DnsCheck` so Swagger UI branding should remain consistent.

Keep this guide current when architecture or conventions change to help future agents ramp up quickly.

