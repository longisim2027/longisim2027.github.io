"""Run the unmodified PCUB backend request handler inside the browser (Pyodide).

The demo_backend package is the published research code, byte-for-byte. Each
request is fed to the server's own ``Handler.route()``, so routing, request
validation, idempotency and error mapping are exactly what the local server
runs. Only the transport (socket -> Web Worker message) is replaced.
"""
import io
import json

from demo_backend.adapters.resources import Resources
from demo_backend.adapters.sqlite import Store
from demo_backend.api.server import handler
from demo_backend.application.backend import Backend

_Handler = None


def start(assets: str, database: str) -> None:
    """Build the backend exactly as server.main() does in offline mode."""
    global _Handler
    _Handler = handler(Backend(Resources(assets, None), Store(database)), allowed_origin=None, token=None)


class _Headers(dict):
    def get(self, key, default=None):
        for k, v in self.items():
            if k.lower() == key.lower():
                return v
        return default


def dispatch(method: str, path: str, key: str, body: str) -> str:
    """Handle one request; return JSON text {"status": int, "body": value}."""
    h = _Handler.__new__(_Handler)  # no socket: skip BaseHTTPRequestHandler.__init__
    raw = body.encode("utf-8")
    headers = _Headers()
    if key:
        headers["Idempotency-Key"] = key
    if method == "POST":
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(raw))
    h.headers = headers
    h.path = path
    h.rfile = io.BytesIO(raw)
    out = {}

    def send(status, value):
        out["status"] = status
        out["body"] = value

    h.send = send
    h.route(method)
    return json.dumps(out, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
