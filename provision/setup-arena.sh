#!/bin/bash
# Build and deploy the Tetrapod AI Game Arena (Mindustry plugin + Bun server + web UI).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> building Mindustry arena-bridge.jar"
"$HERE/arena/mindustry-plugin/build.sh"

echo "==> restarting Mindustry container with arena-bridge"
sudo docker compose -f "$HERE/docker-compose.yml" up -d mindustry
for _ in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:6568/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> deploying /opt/tetrapod/arena"
sudo install -d -o tetraslam -g tetraslam /opt/tetrapod/arena /opt/tetrapod/arena/server /opt/tetrapod/arena/web
cp "$HERE/arena/server/index.ts" "$HERE/arena/server/rcon.ts" /opt/tetrapod/arena/server/
cp "$HERE/arena/web/index.html" /opt/tetrapod/arena/web/index.html

echo "==> installing & starting tetrapod-arena.service"
sudo cp "$HERE/systemd/tetrapod-arena.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tetrapod-arena.service
sudo systemctl restart tetrapod-arena.service

echo "==> reloading Caddy for arena.tetraslam.world"
sudo docker exec provision-caddy-1 caddy reload --config /etc/caddy/Caddyfile

sleep 2
curl -fsS http://127.0.0.1:6570/health
echo ""
echo "==> arena deployed at https://arena.tetraslam.world"
