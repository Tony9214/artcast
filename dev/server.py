#!/usr/bin/env python3
# Dev server: mimics the Android app's HTTP API + static hosting on desktop.
# Usage: python3 dev/server.py [port]
#   projector page -> http://127.0.0.1:8917/app/
#   phone page     -> http://<lan-ip>:8917/

import json
import mimetypes
import os
import socket
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WWW = os.path.join(ROOT, "app", "src", "main", "assets", "www")
DATA = os.path.join(ROOT, "dev", "data")
IMG = os.path.join(DATA, "img")
STATE_FILE = os.path.join(DATA, "state.json")
os.makedirs(IMG, exist_ok=True)

DEFAULT_STATE = {
    "imageId": None,
    "mode": "original",
    "invert": False,
    "grid": {"on": False, "n": 3},
    "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
    "history": [],
}


def load_state():
    if not os.path.exists(STATE_FILE):
        return dict(DEFAULT_STATE)
    try:
        s = json.load(open(STATE_FILE))
        for k, v in DEFAULT_STATE.items():
            s.setdefault(k, v)
        return s
    except Exception:
        return dict(DEFAULT_STATE)


STATE = load_state()


def save_state():
    os.makedirs(DATA, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(STATE, f)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    # ---- helpers ----
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not os.path.isfile(path):
            return self.send_json({"error": "not found"}, 404)
        mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    # ---- static ----
    def static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        if path in ("/app", "/app/"):
            path = "/app/index.html"
        full = os.path.normpath(os.path.join(WWW, path.lstrip("/")))
        if not full.startswith(WWW):
            return self.send_json({"error": "forbidden"}, 403)
        return self.send_file(full)

    # ---- api ----
    def api(self, method, path, query):
        global STATE
        if path == "/api/info" and method == "GET":
            return self.send_json({"uploadUrl": f"http://{lan_ip()}:{self.server.server_port}/", "version": 1})

        if path == "/api/state" and method == "GET":
            return self.send_json(STATE)

        if path == "/api/state" and method == "POST":
            try:
                patch = json.loads(self.body() or b"{}")
            except Exception:
                patch = {}
            for k in ("imageId", "mode", "invert", "grid", "corners"):
                if k in patch:
                    STATE[k] = patch[k]
            save_state()
            return self.send_json(STATE)

        if path == "/api/image" and method == "PUT":
            name = (query.get("name") or ["image"])[0]
            ext = "".join(c for c in name.rsplit(".", 1)[-1].lower() if c.isalnum()) or "jpg"
            iid = f"{int(time.time()*1000)}-{uuid.uuid4().hex[:8]}.{ext}"
            with open(os.path.join(IMG, iid), "wb") as f:
                f.write(self.body())
            STATE["history"].insert(0, {"id": iid, "name": name, "ts": int(time.time() * 1000)})
            while len(STATE["history"]) > 60:
                old = STATE["history"].pop()
                try:
                    os.remove(os.path.join(IMG, old["id"]))
                except OSError:
                    pass
            STATE["imageId"] = iid
            save_state()
            return self.send_json({"id": iid})

        if path.startswith("/api/image/") and method == "GET":
            iid = path[len("/api/image/"):]
            if "/" in iid or ".." in iid:
                return self.send_json({"error": "bad id"}, 400)
            return self.send_file(os.path.join(IMG, iid))

        if path == "/api/history" and method == "GET":
            return self.send_json(STATE["history"])

        if path.startswith("/api/history/") and method == "DELETE":
            iid = path[len("/api/history/"):]
            STATE["history"] = [h for h in STATE["history"] if h["id"] != iid]
            try:
                os.remove(os.path.join(IMG, iid))
            except OSError:
                pass
            if STATE.get("imageId") == iid:
                STATE["imageId"] = None
            save_state()
            return self.send_json({})

        return self.send_json({"error": "not found"}, 404)

    # ---- dispatch ----
    def dispatch(self, method):
        path = urlparse(self.path).path
        query = parse_qs(urlparse(self.path).query)
        if path.startswith("/api/"):
            return self.api(method, path, query)
        if method == "GET":
            return self.static(path)
        return self.send_json({"error": "not found"}, 404)

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def do_PUT(self):
        self.dispatch("PUT")

    def do_DELETE(self):
        self.dispatch("DELETE")


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8917
    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    print(f"projector page: http://127.0.0.1:{port}/app/")
    print(f"phone page:     http://{lan_ip()}:{port}/")
    srv.serve_forever()
