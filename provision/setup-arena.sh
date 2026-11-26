#!/bin/bash
# Build and deploy the Tetrapod AI Game Arena (Mindustry plugin + Bun server + web UI).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> building Mindustry arena-bridge.jar"
"$HERE/arena/mindustry-plugin/build.sh"

echo "==> extracting official Mindustry v159.7 sprite atlas"
"$HERE/arena/mindustry-plugin/extract-sprites.sh"

echo "==> restarting Mindustry container with arena-bridge"
sudo docker compose -f "$HERE/docker-compose.yml" up -d mindustry
sudo docker restart provision-mindustry-1
for _ in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:6568/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "==> building the web UI (vite)"
# bun comes from mise on tetrapod and is not on a non-interactive PATH.
export PATH="$HOME/.local/share/mise/shims:$HOME/.bun/bin:$PATH"
(
  cd "$HERE/arena/web"
  bun install --frozen-lockfile
  bun run build
)

echo "==> deploying /opt/tetrapod/arena"
sudo install -d -o tetraslam -g tetraslam /opt/tetrapod/arena /opt/tetrapod/arena/server /opt/tetrapod/arena/web
cp "$HERE/arena/server/index.ts" "$HERE/arena/server/rcon.ts" /opt/tetrapod/arena/server/
# Swap the whole build in, so hashed assets from older builds don't pile up.
rm -rf /opt/tetrapod/arena/web.next
cp -r "$HERE/arena/web/dist" /opt/tetrapod/arena/web.next
rm -rf /opt/tetrapod/arena/web
mv /opt/tetrapod/arena/web.next /opt/tetrapod/arena/web

echo "==> installing & starting tetrapod-arena.service"
sudo cp "$HERE/systemd/tetrapod-arena.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tetrapod-arena.service
sudo systemctl restart tetrapod-arena.service

echo "==> restarting Caddy for arena.tetraslam.world (picks up updated Caddyfile inode)"
sudo docker restart provision-caddy-1

sleep 2
curl -fsS http://127.0.0.1:6570/health
echo ""
echo "==> arena deployed at https://arena.tetraslam.world"
