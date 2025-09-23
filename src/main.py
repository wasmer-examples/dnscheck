from fastapi import FastAPI, WebSocket
from fastapi.responses import HTMLResponse
import os

app = FastAPI(title="FastAPI WebSocket Echo")

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
            "<!-- JS_PLACEHOLDER -->",
            f"<script>\n{js_code}\n</script>"
        )
        return injected
    except Exception as e:
        print(f"Error loading HTML template: {e}")
        return "<!DOCTYPE html><html><body>ERROR: Could not load index.html template!</body></html>"

ROOT_HTML = load_html_template()


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root() -> str:
    return ROOT_HTML


@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    MAX_LEN = 500
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            # Enforce max length of 500 characters on server as well
            if len(data) > MAX_LEN:
                data = data[:MAX_LEN]
            # Echo back exactly what was sent so client can measure RTT
            await websocket.send_text(data)
    except Exception:
        # Connection closed or errored; exit gracefully
        pass


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
