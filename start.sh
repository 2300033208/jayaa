#!/usr/bin/env sh
# Starts the Atomic Gravity Simulator (engine + built frontend on http://127.0.0.1:8000) and opens it.
cd "$(dirname "$0")" || exit 1
exec python3 run.py "$@"
