"""Start the Atomic Gravity Simulator on this computer (Windows, macOS, Linux).

    python run.py              build the frontend if needed, start the engine, open the browser
    python run.py --rebuild    rebuild the frontend first
    python run.py --dev        development mode: engine with auto-reload + Vite dev server (port 5173)
    python run.py --host 0.0.0.0 --port 8000 --no-browser   serve on the network (see DEPLOYMENT.md)

The engine serves the built frontend and the API from one port. Data are stored in engine/data
(SQLite) unless DATABASE_URL points to PostgreSQL.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENGINE = ROOT / "engine"
FRONTEND = ROOT / "frontend"
DIST = FRONTEND / "dist"
REQUIRED_MODULES = ("fastapi", "uvicorn", "numpy", "scipy", "sqlalchemy", "alembic", "argon2", "multipart",
                    "tifffile")


def fail(message: str) -> None:
    print(f"\n{message}\n", file=sys.stderr)
    raise SystemExit(1)


def check_python() -> None:
    if sys.version_info < (3, 11):
        fail(f"Python 3.11 or newer is required (this is {sys.version.split()[0]}).")
    missing = [m for m in REQUIRED_MODULES if importlib.util.find_spec(m) is None]
    if missing:
        fail(f"Missing Python packages: {', '.join(missing)}.\n"
             f"Install them with:  {sys.executable} -m pip install -r engine/requirements.txt")


def npm() -> str:
    exe = shutil.which("npm.cmd" if os.name == "nt" else "npm") or shutil.which("npm")
    if exe is None:
        fail("Node.js (with npm) is needed to build the frontend: https://nodejs.org (version 20 or newer).")
    return exe  # type: ignore[return-value]


def build_frontend(force: bool) -> None:
    if (DIST / "index.html").is_file() and not force:
        return
    exe = npm()
    if not (FRONTEND / "node_modules").is_dir():
        print("Installing frontend dependencies (first run only)…")
        subprocess.run([exe, "ci"], cwd=FRONTEND, check=True)
    print("Building the frontend…")
    subprocess.run([exe, "run", "build"], cwd=FRONTEND, check=True)


def wait_for(url: str, process: subprocess.Popen, timeout: float = 60.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            fail("The engine stopped during start-up; see the messages above.")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:  # noqa: S310 - local health check
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.4)
    fail(f"The engine did not answer at {url} within {timeout:.0f} s.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Start the Atomic Gravity Simulator.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--rebuild", action="store_true", help="rebuild the frontend before starting")
    parser.add_argument("--dev", action="store_true", help="auto-reloading engine and Vite dev server")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    check_python()
    env = dict(os.environ)
    processes: list[subprocess.Popen] = []
    if args.dev:
        engine_cmd = [sys.executable, "-m", "uvicorn", "engine.main:app", "--host", "127.0.0.1", "--port",
                      str(args.port), "--reload"]
        app_url = "http://127.0.0.1:5173"
    else:
        build_frontend(args.rebuild)
        env["ENGINE_STATIC_DIR"] = str(DIST)
        engine_cmd = [sys.executable, "-m", "uvicorn", "engine.main:app", "--host", args.host, "--port",
                      str(args.port), "--proxy-headers"]
        shown_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        app_url = f"http://{shown_host}:{args.port}"

    engine = subprocess.Popen(engine_cmd, cwd=ENGINE, env=env)
    processes.append(engine)
    try:
        wait_for(f"http://127.0.0.1:{args.port}/api/health", engine)
        if args.dev:
            processes.append(subprocess.Popen([npm(), "run", "dev"], cwd=FRONTEND,
                                              env={**env, "ENGINE_URL": f"http://127.0.0.1:{args.port}"}))
            time.sleep(3)
        print(f"\nAtomic Gravity Simulator is running at {app_url}  (Ctrl+C to stop)\n")
        if not args.no_browser:
            webbrowser.open(app_url)
        while all(p.poll() is None for p in processes):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        for p in processes:
            if p.poll() is None:
                if os.name == "nt":
                    p.terminate()
                else:
                    p.send_signal(signal.SIGINT)  # lets uvicorn finish running tasks cleanly
        for p in processes:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()


if __name__ == "__main__":
    main()
