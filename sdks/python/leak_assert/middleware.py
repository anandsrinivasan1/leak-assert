"""
leak-assert HTTP sidecar for Python.

Exposes /__leak_assert__/heap so the CLI can remotely sample heap stats.

Works as:
  - Pure WSGI middleware (Django, Flask, any WSGI app)
  - FastAPI / Starlette ASGI middleware
  - Standalone aiohttp / asyncio server

Usage — FastAPI:

    from fastapi import FastAPI
    from leak_assert.middleware import LeakAssertMiddleware

    app = FastAPI()
    app.add_middleware(LeakAssertMiddleware)

Usage — Flask / Django (WSGI):

    from leak_assert.middleware import LeakAssertWSGIMiddleware
    app.wsgi_app = LeakAssertWSGIMiddleware(app.wsgi_app)

Usage — standalone:

    from leak_assert.middleware import run_sidecar_server
    run_sidecar_server(port=9123)
"""
from __future__ import annotations

import gc
import json
import time
import tracemalloc
from typing import Any, Callable


# ── Heap snapshot ─────────────────────────────────────────────────────────────

def _snapshot() -> dict:
    current, peak = (0, 0)
    if tracemalloc.is_tracing():
        current, peak = tracemalloc.get_traced_memory()

    rss = 0
    try:
        import resource
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
    except Exception:
        pass

    return {
        "ts":         int(time.time() * 1000),
        "heap_used":  current,
        "heap_total": peak,
        "rss":        rss,
        "external":   0,
        "gc_count":   sum(gc.get_count()),
        "tracemalloc": tracemalloc.is_tracing(),
    }


_JSON_HEADERS = [("Content-Type", "application/json")]


# ── ASGI middleware (FastAPI / Starlette) ─────────────────────────────────────

class LeakAssertMiddleware:
    """ASGI middleware — add to FastAPI/Starlette apps."""

    def __init__(self, app: Any, prefix: str = "/__leak_assert__") -> None:
        self.app    = app
        self.prefix = prefix

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or not scope["path"].startswith(self.prefix):
            await self.app(scope, receive, send)
            return

        path   = scope["path"][len(self.prefix):]
        client = scope.get("client")
        host   = client[0] if client else ""

        if host not in ("127.0.0.1", "::1", ""):
            body = json.dumps({"error": "forbidden: sidecar is localhost-only"}).encode()
            await _asgi_response(send, 403, body)
            return

        if path in ("/heap", "/heap/"):
            body = json.dumps(_snapshot()).encode()
            await _asgi_response(send, 200, body)
            return

        if path in ("/gc", "/gc/"):
            collected = sum(gc.collect(i) for i in range(3))
            body = json.dumps({"ok": True, "collected": collected}).encode()
            await _asgi_response(send, 200, body)
            return

        body = json.dumps({"error": "not found"}).encode()
        await _asgi_response(send, 404, body)


async def _asgi_response(send: Any, status: int, body: bytes) -> None:
    await send({
        "type":    "http.response.start",
        "status":  status,
        "headers": [[b"content-type", b"application/json"],
                    [b"content-length", str(len(body)).encode()]],
    })
    await send({"type": "http.response.body", "body": body})


# ── WSGI middleware (Flask / Django) ──────────────────────────────────────────

class LeakAssertWSGIMiddleware:
    """WSGI middleware — wrap any WSGI app."""

    def __init__(self, app: Callable, prefix: str = "/__leak_assert__") -> None:
        self.app    = app
        self.prefix = prefix

    def __call__(self, environ: dict, start_response: Callable) -> Any:
        path = environ.get("PATH_INFO", "")
        if not path.startswith(self.prefix):
            return self.app(environ, start_response)

        sub = path[len(self.prefix):]

        if sub in ("/heap", "/heap/"):
            body = json.dumps(_snapshot()).encode()
            start_response("200 OK", _JSON_HEADERS)
            return [body]

        if sub in ("/gc", "/gc/"):
            collected = sum(gc.collect(i) for i in range(3))
            body = json.dumps({"ok": True, "collected": collected}).encode()
            start_response("200 OK", _JSON_HEADERS)
            return [body]

        body = json.dumps({"error": "not found"}).encode()
        start_response("404 Not Found", _JSON_HEADERS)
        return [body]


# ── Standalone asyncio server ─────────────────────────────────────────────────

def run_sidecar_server(
    port:   int = 9123,
    host:   str = "127.0.0.1",
    prefix: str = "/__leak_assert__",
) -> None:
    """Start a standalone sidecar server (blocking).  For dev/test use only."""
    from http.server import BaseHTTPRequestHandler, HTTPServer

    _prefix = prefix

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if not self.path.startswith(_prefix):
                self._respond(404, {"error": "not found"})
                return
            sub = self.path[len(_prefix):]
            if sub in ("/heap", "/heap/"):
                self._respond(200, _snapshot())
            elif sub in ("/gc", "/gc/"):
                self._respond(200, {"ok": True, "collected": sum(gc.collect(i) for i in range(3))})
            else:
                self._respond(404, {"error": "not found"})

        def _respond(self, status: int, data: dict) -> None:
            body = json.dumps(data).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: Any) -> None:
            pass  # silence request logs

    tracemalloc.start()
    server = HTTPServer((host, port), _Handler)
    print(f"[leak-assert] sidecar listening on http://{host}:{port}{prefix}/heap")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
