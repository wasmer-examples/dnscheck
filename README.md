# FastAPI WebSocket Echo + Wasmer

This example demonstrates a minimal FastAPI WebSocket echo server with a small Bulma‑styled UI. Open the page, it connects to a WebSocket, and anything you send is echoed back. The UI shows connection status, a message list with timestamps, and round‑trip time (RTT) for echoes.

## Features

- WebSocket endpoint at `/api/ws` that echoes back text messages.
- Bulma‑styled UI with:
  - Status tag (Connecting / Connected / Disconnected)
  - Input and Send button (default text: "Hello Wasmer!")
  - Message list that shows timestamps and RTT
  - Reconnect button when disconnected

All logic lives in a single file: `src/main.py`.

## Run Locally

1. Install dependencies (uv recommended but pip works too):

```bash
pip install fastapi uvicorn
```

2. Start the server:

```bash
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
```

3. Open the app:

```
http://localhost:8000
```

Type a message (pre-filled with "Hello Wasmer!") and press Enter or click Send. You’ll see both the sent message and the echoed response with a timestamp; the RTT appears when the echoed message is received.

## Code Overview

- `GET /` serves an HTML page with Bulma CSS and a small client script that:
  - connects to `ws://<host>/api/ws` (or `wss://` on HTTPS)
  - updates the status tag based on connection state
  - sends messages and renders received ones
  - attaches a transient id to messages to compute RTT on echo
- `WEBSOCKET /api/ws` accepts text frames and sends them back unchanged.

Relevant file:

- `src/main.py`

## Deploying to Wasmer Edge (Overview)

1. Ensure your entrypoint runs Uvicorn, for example:

```
uvicorn src.main:app --host 0.0.0.0 --port $PORT
```

2. Deploy to Wasmer Edge with your preferred workflow and open your subdomain `https://<your-subdomain>.wasmer.app/`.

That’s it—open the page, send a message, and see it echoed back in real time.
