#!/usr/bin/env python3
"""
On-demand localhost server for the whiteboard skill.

Serves boards from ~/whiteboards/<slug>/ over http://127.0.0.1. A real origin is what
makes the save-back work: the board POSTs its snapshot to /save/<slug>, which this
server writes to disk. The server auto-shuts down after ~1h of inactivity and is
re-started / life-extended every time this skill runs.

Usage:
  # ensure a board is live and open it in the browser:
  python3 serve.py --slug auth-flow --open
  # just make sure the server is up (no browser):
  python3 serve.py --ensure
  # internal (spawned detached): the actual server loop
  python3 serve.py --serve
"""
import argparse, os, re, sys, time, json, socket, subprocess, threading, shutil, webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE      = os.path.dirname(os.path.abspath(__file__))
APP_HTML  = os.path.join(HERE, "app.html")
ROOT      = os.path.expanduser(os.environ.get("WHITEBOARDS_DIR", "~/whiteboards"))
PORT      = int(os.environ.get("WHITEBOARD_PORT", "7830"))
HOST      = "127.0.0.1"
PIDFILE   = os.path.join(ROOT, ".server.pid")
LOGFILE   = os.path.join(ROOT, ".server.log")
IDLE_SECS = 3600  # shut down after this many seconds with no requests

_last_hit = [time.time()]


def _port_open(host, port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.25)
        return s.connect_ex((host, port)) == 0


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_GET(self):
        _last_hit[0] = time.time()
        return super().do_GET()

    def do_POST(self):
        # Save-back: POST /save/<slug>  body = board snapshot JSON -> <slug>/snapshot.json
        _last_hit[0] = time.time()
        m = re.fullmatch(r"/save/([a-zA-Z0-9_-]+)", self.path or "")
        if not m:
            self.send_error(404, "unknown POST route")
            return
        slug = m.group(1)
        board_dir = os.path.join(ROOT, slug)
        if not os.path.isdir(board_dir):
            self.send_error(404, "no such board")
            return
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n)
            data = json.loads(raw)  # validate it's JSON before writing
            tmp = os.path.join(board_dir, ".snapshot.tmp")
            with open(tmp, "w") as f:
                json.dump(data, f)
            os.replace(tmp, os.path.join(board_dir, "snapshot.json"))
        except Exception as e:
            self.send_error(400, "bad snapshot: %s" % e)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *a):  # keep the detached log quiet
        pass


def _idle_watchdog(httpd):
    while True:
        time.sleep(60)
        if time.time() - _last_hit[0] > IDLE_SECS:
            try:
                os.path.exists(PIDFILE) and os.remove(PIDFILE)
            except OSError:
                pass
            httpd.shutdown()
            return


def run_server():
    os.makedirs(ROOT, exist_ok=True)
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    with open(PIDFILE, "w") as f:
        f.write(str(os.getpid()))
    threading.Thread(target=_idle_watchdog, args=(httpd,), daemon=True).start()
    try:
        httpd.serve_forever()
    finally:
        try:
            if os.path.exists(PIDFILE):
                os.remove(PIDFILE)
        except OSError:
            pass


def ensure_running():
    """Start the detached server if it isn't already listening. Returns True if up."""
    os.makedirs(ROOT, exist_ok=True)
    if _port_open(HOST, PORT):
        _last_hit[0] = time.time()
        return True
    # spawn ourselves detached in --serve mode
    log = open(LOGFILE, "a")
    subprocess.Popen(
        [sys.executable, os.path.abspath(__file__), "--serve"],
        stdout=log, stderr=log, stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    for _ in range(40):  # wait up to ~10s for it to bind
        if _port_open(HOST, PORT):
            return True
        time.sleep(0.25)
    return False


def stage_slug(slug):
    """Copy the shared app.html into the board dir as index.html so app updates propagate."""
    board_dir = os.path.join(ROOT, slug)
    os.makedirs(board_dir, exist_ok=True)
    shutil.copyfile(APP_HTML, os.path.join(board_dir, "index.html"))
    return board_dir


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--serve", action="store_true", help="internal: run the server loop")
    ap.add_argument("--ensure", action="store_true", help="ensure the server is running")
    ap.add_argument("--slug", help="board slug under ~/whiteboards/")
    ap.add_argument("--open", action="store_true", help="open the board in the browser")
    ap.add_argument("--reseed", action="store_true",
                    help="discard saved markup and re-seed the board from board.json")
    args = ap.parse_args()

    if args.serve:
        run_server()
        return

    if not ensure_running():
        print("ERROR: whiteboard server failed to start (see %s)" % LOGFILE, file=sys.stderr)
        sys.exit(1)

    if args.slug:
        board_dir = stage_slug(args.slug)
        if args.reseed:
            # drop any saved markup so the board rebuilds cleanly from board.json
            snap = os.path.join(board_dir, "snapshot.json")
            if os.path.exists(snap):
                os.remove(snap)
        url = "http://%s:%d/%s/index.html" % (HOST, PORT, args.slug)
        if args.reseed:
            url += "?reseed=1"
        print(url)
        if args.open:
            webbrowser.open(url)
    else:
        print("http://%s:%d/" % (HOST, PORT))


if __name__ == "__main__":
    main()
