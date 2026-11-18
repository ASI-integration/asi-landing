#!/usr/bin/env python3
"""Read-only public ASI map. No GitHub token, admin route or shared DB access."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import json, os

ROOT = Path("/opt/asi-ops-map")
PORT = int(os.getenv("ASI_MAP_PORT", "3101"))

class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self._head_only = True
        self.do_GET()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ("/", "/roadmap", "/roadmap/"):
            file, kind = ROOT / "index.html", "text/html; charset=utf-8"
        elif path in ("/ops-map-status.json", "/roadmap/ops-map-status.json"):
            file, kind = ROOT / "ops-map-status.json", "application/json; charset=utf-8"
        elif path in ("/healthz", "/roadmap/healthz"):
            payload = b'{"ok":true,"service":"asi-progress-map"}'
            return self.respond(200, "application/json; charset=utf-8", payload)
        else:
            return self.respond(404, "text/plain; charset=utf-8", "Не найдено".encode())
        try:
            payload = file.read_bytes()
        except FileNotFoundError:
            return self.respond(503, "text/plain; charset=utf-8", "Данные ещё готовятся".encode())
        return self.respond(200, kind, payload)

    def respond(self, status, content_type, data):
        self.send_response(status)
        for k, v in (
            ("Content-Type", content_type), ("Content-Length", str(len(data))),
            ("Cache-Control", "no-store, max-age=0"),
            ("X-Content-Type-Options", "nosniff"),
            ("Referrer-Policy", "no-referrer"),
            ("X-Frame-Options", "DENY"),
            ("Content-Security-Policy",
             "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
             "connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; "
             "frame-ancestors 'none'")):
            self.send_header(k,v)
        self.end_headers()
        if not getattr(self, "_head_only", False):
            self.wfile.write(data)

    def log_message(self, fmt, *args):
        pass

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
