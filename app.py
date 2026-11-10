"""
Quantum Space Lab - desktop app
================================
Starts a small local server (only reachable from this computer) for the 3D
interface and the Qiskit engine, then opens it in a desktop window.

    python app.py              # desktop window (PySide6 + QtWebEngine)
    python app.py --browser    # open in your web browser instead
"""
import argparse
import json
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = ROOT
SCENARIOS = os.path.join(ROOT, "scenarios")
TOKEN = secrets.token_urlsafe(16)

try:
    import quantum_backend as qb
except Exception as exc:  # Qiskit missing: the 3D app still works in browser mode
    qb = None
    print(f"[warn] Qiskit backend unavailable ({exc}). Install with: pip install -r requirements.txt")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".json": "application/json"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- helpers ----------
    def _json(self, obj, code=200):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self):
        if self.headers.get("X-Lab-Token") != TOKEN:
            self._json({"error": "bad token"}, 403)
            return False
        return True

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n) or b"{}")

    # ---------- routes ----------
    def do_GET(self):
        if self.path.startswith("/api/"):
            if not self._authorised():
                return
            if self.path == "/api/status":
                if not qb:
                    return self._json({"error": "qiskit not installed"}, 503)
                return self._json({"qiskit": qb.QISKIT_VERSION})
            if self.path == "/api/scenario":
                path = os.path.join(SCENARIOS, "current.json")
                if os.path.exists(path):
                    with open(path, encoding="utf-8") as f:
                        return self._json(json.load(f))
                return self._json({})
            return self._json({"error": "not found"}, 404)
        return super().do_GET()

    def do_POST(self):
        if not self.path.startswith("/api/") or not self._authorised():
            return
        try:
            body = self._body()
            if self.path == "/api/scenario":
                os.makedirs(SCENARIOS, exist_ok=True)
                with open(os.path.join(SCENARIOS, "current.json"), "w", encoding="utf-8") as f:
                    json.dump(body, f, indent=2)
                return self._json({"ok": True})
            if not qb:
                return self._json({"error": "Qiskit is not installed"}, 503)
            if self.path == "/api/bell":
                return self._json(qb.run_chsh(float(body["p"]), int(body.get("shots", 2000))))
            if self.path == "/api/e91":
                return self._json(qb.run_e91(float(body["p"]), int(body.get("pairs", 4000)), float(body.get("eve", 0))))
            if self.path == "/api/run":
                return self._json(run_user_code(body.get("code", ""), body.get("link", {})))
            return self._json({"error": "not found"}, 404)
        except Exception as exc:
            return self._json({"error": str(exc)}, 500)


def run_user_code(code, link):
    """Run Code Lab code in a separate Python process (60 s limit)."""
    with tempfile.TemporaryDirectory() as tmp:
        code_file, link_file = os.path.join(tmp, "code.py"), os.path.join(tmp, "link.json")
        with open(code_file, "w", encoding="utf-8") as f:
            f.write(code)
        with open(link_file, "w", encoding="utf-8") as f:
            json.dump(link, f)
        try:
            r = subprocess.run([sys.executable, os.path.join(ROOT, "code_runner.py"), code_file, link_file],
                               capture_output=True, text=True, timeout=60, cwd=ROOT)
            err = r.stderr
            if r.returncode != 0 and "Traceback" in err:   # keep only the user's part of the traceback
                lines = err.splitlines()
                start = next((i for i, l in enumerate(lines) if l.strip().startswith('File "code_lab.py"')), 0)
                err = "Traceback (most recent call last):\n" + "\n".join(lines[start:])
            return {"ok": r.returncode == 0, "stdout": r.stdout, "stderr": err}
        except subprocess.TimeoutExpired:
            return {"ok": False, "stdout": "", "stderr": "Stopped: the code ran longer than 60 seconds."}


class QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return  # the browser closed a request early (normal on reload)
        super().handle_error(request, client_address)


def start_server(port):
    server = QuietServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def open_window(url):
    os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--ignore-gpu-blocklist --enable-gpu-rasterization")
    from PySide6.QtCore import QUrl
    from PySide6.QtWidgets import QApplication
    from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineSettings
    from PySide6.QtWebEngineWidgets import QWebEngineView

    class Page(QWebEnginePage):
        def javaScriptConsoleMessage(self, level, message, line, source):
            if level != QWebEnginePage.JavaScriptConsoleMessageLevel.InfoMessageLevel:
                print(f"[js] {message} ({os.path.basename(source)}:{line})")

    app = QApplication(sys.argv)
    app.setApplicationName("Quantum Space Lab")
    view = QWebEngineView()
    page = Page(view)
    view.setPage(page)
    s = page.settings()
    s.setAttribute(QWebEngineSettings.WebAttribute.WebGLEnabled, True)
    s.setAttribute(QWebEngineSettings.WebAttribute.Accelerated2dCanvasEnabled, True)
    view.setWindowTitle("Quantum Space Lab")
    view.resize(1600, 950)
    view.load(QUrl(url))
    view.showMaximized()
    return app.exec()


def main():
    ap = argparse.ArgumentParser(description="Quantum Space Lab")
    ap.add_argument("--browser", action="store_true", help="open in the web browser instead of a desktop window")
    ap.add_argument("--port", type=int, default=0, help="local port (default: any free port)")
    args = ap.parse_args()

    server = start_server(args.port)
    url = f"http://127.0.0.1:{server.server_address[1]}/index.html?token={TOKEN}"
    print(f"Quantum Space Lab running at {url}")

    if not args.browser:
        try:
            sys.exit(open_window(url))
        except ImportError as exc:
            print(f"[info] Desktop window unavailable ({exc}); opening your browser instead.")
    webbrowser.open(url)
    print("Press Ctrl+C to quit.")
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
