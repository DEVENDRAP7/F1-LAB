#!/usr/bin/env python3
"""Serve public/ over plain HTTP for local development.

This is the only server in the project (docs/SPEC.md) — it exists purely
so `fetch()` calls against public/data/*.json and *.bin work the same way
they will once GitHub Pages serves the built site. It never proxies to
any API and never runs at request time in production.
"""
import http.server
import functools
from pathlib import Path

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

if __name__ == "__main__":
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(PUBLIC_DIR))
    with http.server.ThreadingHTTPServer(("127.0.0.1", 8787), handler) as httpd:
        print(f"Serving {PUBLIC_DIR} at http://127.0.0.1:8787")
        httpd.serve_forever()
