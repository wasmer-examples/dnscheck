# FastAPI WebSocket Echo + Wasmer

**See it in action:** https://python-fastapi-websockets.wasmer.app/

This example demonstrates a minimal FastAPI WebSocket echo server with a small Bulma‑styled UI.

Open the page, it connects to a WebSocket, and anything you send is echoed back.
The UI shows connection status, a message list with timestamps, and round‑trip time (RTT) for echoes.

## Features

- WebSocket endpoint at `/api/ws` that echoes back text messages.
- Bulma‑styled UI with:
  - Status tag (Connecting / Connected / Disconnected)
  - Input and Send button (default text: "Hello Wasmer!")
  - Message list that shows timestamps and RTT
  - Reconnect button when disconnected

All logic lives in a single file: `src/main.py`.

## Run Locally


* Install `uv`
* Run `uv sync`
* Run `make run-wasmer`


## Deploying to Wasmer Edge (Overview)

1. Ensure your entrypoint runs Uvicorn, for example:

```
uvicorn src.main:app --host 0.0.0.0 --port $PORT
```

2. Deploy to Wasmer Edge with your preferred workflow and open your subdomain `https://<your-subdomain>.wasmer.app/`.

That’s it—open the page, send a message, and see it echoed back in real time.
