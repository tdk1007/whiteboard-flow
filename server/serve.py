#!/usr/bin/env python3
"""
whiteboard-flow — local board server.

Serves the built Svelte Flow app out of ../dist and owns the two API calls the
board needs:

    GET  /api/board?slug=<slug>     board.json + any feedback saved so far
    POST /api/feedback?slug=<slug>  overwrite feedback.json (atomic)

Everything stays on 127.0.0.1 and on disk. No accounts, no cloud, no telemetry.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import socket
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DIST = ROOT / "dist"
BOARDS = Path(os.environ.get("FLOW_BOARDS_DIR", ROOT / "boards")).expanduser()

DEFAULT_PORT = 7840
IDLE_SHUTDOWN_S = 60 * 60  # an hour of no requests and the server retires itself

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".map": "application/json",
}

_last_hit = time.time()
_lock = threading.Lock()


def board_dir(slug: str) -> Path:
    safe = "".join(c for c in slug if c.isalnum() or c in "-_.")
    if not safe or safe.startswith("."):
        raise ValueError(f"bad slug: {slug!r}")
    return BOARDS / safe


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default
    except json.JSONDecodeError as e:
        raise ValueError(f"{path} is not valid JSON: {e}") from e


def write_json_atomic(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False))
    tmp.replace(path)


class Handler(BaseHTTPRequestHandler):
    server_version = "whiteboard-flow"

    # ------------------------------------------------------------- helpers
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def _slug(self, q) -> str:
        return (q.get("slug") or ["default"])[0]

    def log_message(self, fmt, *args):  # quieter than the default
        if "--verbose" in sys.argv:
            super().log_message(fmt, *args)

    # ------------------------------------------------------------- routing
    def do_GET(self):
        global _last_hit
        _last_hit = time.time()
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/api/board":
            return self.api_board(self._slug(q))
        if u.path == "/api/boards":
            slugs = sorted(p.name for p in BOARDS.glob("*/board.json") for p in [p.parent])
            return self._json(200, {"boards": slugs})
        if u.path == "/api/health":
            return self._json(200, {"ok": True, "boards_dir": str(BOARDS)})
        return self.serve_static(u.path)

    def do_POST(self):
        global _last_hit
        _last_hit = time.time()
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path != "/api/feedback":
            return self._json(404, {"error": "no such endpoint"})

        length = int(self.headers.get("Content-Length") or 0)
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as e:
            return self._json(400, {"error": f"bad json: {e}"})

        try:
            d = board_dir(self._slug(q))
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        if not (d / "board.json").exists():
            return self._json(404, {"error": f"no board at {d}"})

        payload.setdefault("version", 1)
        payload["updated"] = payload.get("updated") or time.strftime("%Y-%m-%dT%H:%M:%S%z")
        with _lock:
            write_json_atomic(d / "feedback.json", payload)
        return self._json(200, {"ok": True, "path": str(d / "feedback.json")})

    # -------------------------------------------------------------- handlers
    def api_board(self, slug: str):
        try:
            d = board_dir(slug)
            board = read_json(d / "board.json", None)
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        if board is None:
            available = sorted(p.parent.name for p in BOARDS.glob("*/board.json"))
            return self._json(
                404, {"error": f"no board.json at {d}", "available": available}
            )
        board["slug"] = slug
        board["feedback"] = read_json(d / "feedback.json", None)
        board["readCmdBase"] = str(HERE)
        board.setdefault("title", slug)
        return self._json(200, board)

    def serve_static(self, path: str):
        if path in ("/", ""):
            path = "/index.html"
        rel = posixpath.normpath(path).lstrip("/")
        target = (DIST / rel).resolve()
        if not str(target).startswith(str(DIST.resolve())):
            return self._send(403, b"forbidden", "text/plain")
        if not target.is_file():
            # SPA fallback so /?slug=x works on refresh
            target = DIST / "index.html"
            if not target.is_file():
                return self._send(
                    404,
                    b"dist/ not built yet - run: npm run build",
                    "text/plain; charset=utf-8",
                )
        ctype = MIME.get(target.suffix, "application/octet-stream")
        return self._send(200, target.read_bytes(), ctype)


def port_in_use(port: int) -> bool:
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


def idle_watchdog(httpd):
    while True:
        time.sleep(60)
        if time.time() - _last_hit > IDLE_SHUTDOWN_S:
            httpd.shutdown()
            return


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", default="default", help="board to open")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--open", action="store_true", help="open the board in a browser")
    ap.add_argument(
        "--reset",
        action="store_true",
        help="delete this board's feedback.json before serving (start a fresh review)",
    )
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    url = f"http://127.0.0.1:{args.port}/?slug={args.slug}"

    if args.reset:
        fp = board_dir(args.slug) / "feedback.json"
        if fp.exists():
            fp.rename(fp.with_suffix(".json.bak"))
            print(f"reset: previous review moved to {fp.with_suffix('.json.bak')}")
        else:
            print("reset: no feedback to clear")

    if port_in_use(args.port):
        print(f"server already running → {url}")
        if args.open:
            webbrowser.open(url)
        return

    if not (DIST / "index.html").exists():
        print(f"dist/ not built. Run:  cd {ROOT} && npm install && npm run build", file=sys.stderr)
        sys.exit(1)

    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    threading.Thread(target=idle_watchdog, args=(httpd,), daemon=True).start()
    print(f"whiteboard-flow  →  {url}")
    print(f"boards dir       →  {BOARDS}")
    print(f"read feedback    →  python3 {HERE / 'read_feedback.py'} --slug {args.slug}")
    if args.open:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
