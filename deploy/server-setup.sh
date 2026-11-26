#!/usr/bin/env bash
# Installs or updates the Atomic Gravity Simulator on an Ubuntu 24.04 server (run as root).
#   sudo bash server-setup.sh /tmp/app.tar.gz <public hostname>
# The engine runs under systemd on 127.0.0.1:8000; Caddy serves it on HTTPS with an automatic certificate.
set -euo pipefail

BUNDLE=$1
HOST=$2
APP=/opt/atomic-gravity

export DEBIAN_FRONTEND=noninteractive
if ! command -v caddy >/dev/null; then
  apt-get update -q
  apt-get install -yq python3-venv python3-pip debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

id app >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/atomic-gravity app
mkdir -p "$APP"
rm -rf "$APP/engine" "$APP/contract" "$APP/frontend"
tar -xzf "$BUNDLE" -C "$APP"

python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$APP/engine/requirements.txt"

cat > /etc/systemd/system/atomic-gravity.service <<UNIT
[Unit]
Description=Atomic Gravity Simulator
After=network.target

[Service]
User=app
WorkingDirectory=$APP/engine
Environment=ENGINE_STATIC_DIR=$APP/frontend/dist
Environment=ENGINE_DATA_DIR=/var/lib/atomic-gravity/data
Environment=ENGINE_COOKIE_SECURE=always
ExecStartPre=$APP/venv/bin/python -m engine.manage migrate
ExecStart=$APP/venv/bin/uvicorn engine.main:app --host 127.0.0.1 --port 8000 --proxy-headers
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/caddy/Caddyfile <<CADDY
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:8000
}
CADDY

systemctl daemon-reload
systemctl enable --now atomic-gravity
systemctl restart atomic-gravity caddy
sleep 3
curl -fsS http://127.0.0.1:8000/api/health && echo " engine healthy"
