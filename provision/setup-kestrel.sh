#!/bin/bash
# Deploy Kestrel: OpenCode V2 + dotagents config + Discord bridge on tetrapod.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/pnpm:$HOME/.bun/bin:$PATH"

echo "==> syncing ~/.config/opencode from $HERE/opencode"
mkdir -p "$HOME/.config/opencode" "$HOME/.agents/skills" "$HOME/.agent-browser"
chmod 700 "$HOME/.config/opencode"

# Preserve mode-600 secret files while syncing tracked config, agents, skills, commands, plugins.
# Remove symlinks first so cp never writes through legacy symlinks into ~/tetrapod/provision/agent.
rm -f "$HOME/.config/opencode/opencode.json" "$HOME/.config/opencode/AGENTS.md" "$HOME/.config/opencode/package.json"
cp "$HERE/opencode/opencode.json" "$HOME/.config/opencode/opencode.json"
cp "$HERE/opencode/AGENTS.md" "$HOME/.config/opencode/AGENTS.md"
cp "$HERE/opencode/package.json" "$HOME/.config/opencode/package.json"
rm -rf "$HOME/.config/opencode/artifacts" "$HOME/.config/opencode/tell" "$HOME/.config/opencode/mise-shims" \
       "$HOME/.config/opencode/agents" "$HOME/.config/opencode/skills" "$HOME/.config/opencode/commands" "$HOME/.config/opencode/context"
cp -r "$HERE/opencode/artifacts" "$HERE/opencode/tell" "$HERE/opencode/mise-shims" \
      "$HERE/opencode/agents" "$HERE/opencode/skills" "$HERE/opencode/commands" "$HERE/opencode/context" "$HOME/.config/opencode/"
rm -rf "$HOME/.agents/skills/agent-browser"
cp -r "$HERE/opencode/skills/agent-browser" "$HOME/.agents/skills/agent-browser"

echo "==> installing OpenCode plugin dependencies"
(cd "$HOME/.config/opencode" && npm install --silent)

echo "==> configuring agent-browser (Lightpanda default + native ARM64 Chromium fallback)"
cat > "$HOME/.agent-browser/config.json" <<'EOF'
{
  "$schema": "https://agent-browser.dev/schema.json",
  "engine": "lightpanda"
}
EOF
CHROME_BIN="$(find "$HOME/.cache/ms-playwright" -maxdepth 4 -type f -name chrome 2>/dev/null | head -n 1 || true)"
if [ -n "$CHROME_BIN" ]; then
  printf '#!/bin/sh\nexec "%s" --no-sandbox "$@"\n' "$CHROME_BIN" | sudo tee /usr/local/bin/chromium-agent >/dev/null
  sudo chmod 755 /usr/local/bin/chromium-agent
fi

echo "==> provisioning mode-600 secrets from 1Password"
OPENROUTER_KEY="$(opa read 'op://Agents/OpenRouter API Key - tetrapod/credential' 2>/dev/null || true)"
if [ -n "$OPENROUTER_KEY" ]; then
  printf 'OPENROUTER_API_KEY=%s\n' "$OPENROUTER_KEY" | sudo tee /opt/tetrapod/opencode-serve.env >/dev/null
  sudo chown tetraslam:tetraslam /opt/tetrapod/opencode-serve.env
  sudo chmod 600 /opt/tetrapod/opencode-serve.env
fi

DISCORD_TOKEN="$(opa read 'op://Agents/NULLCLAW_DISCORD/bot token' 2>/dev/null || opa read 'op://Agents/NULLCLAW_DISCORD/token' 2>/dev/null || true)"
if [ -z "$DISCORD_TOKEN" ] && [ -f "$HOME/.nullclaw/config.json" ]; then
  DISCORD_TOKEN="$(jq -r '.channels.discord.accounts.default.token // empty' "$HOME/.nullclaw/config.json")"
fi
if [ -z "$DISCORD_TOKEN" ]; then
  echo "ERROR: could not resolve Discord bot token" >&2
  exit 1
fi
{
  printf 'DISCORD_TOKEN=%s\n' "$DISCORD_TOKEN"
  printf 'MENTION_EXEMPT_CHANNELS=1475401568173162578\n'
  printf 'KESTREL_DEFAULT_MODEL=claude-agent/opus\n'
} | sudo tee /opt/tetrapod/kestrel-discord.env >/dev/null
sudo chown tetraslam:tetraslam /opt/tetrapod/kestrel-discord.env
sudo chmod 600 /opt/tetrapod/kestrel-discord.env

echo "==> deploying /opt/tetrapod/kestrel-discord"
sudo install -d -o tetraslam -g tetraslam /opt/tetrapod/kestrel-discord /opt/tetrapod/kestrel
cp "$HERE/kestrel-discord/package.json" "$HERE/kestrel-discord/index.ts" /opt/tetrapod/kestrel-discord/
(cd /opt/tetrapod/kestrel-discord && bun install --silent)

echo "==> stopping legacy nullclaw services"
sudo systemctl disable --now nullclaw.service nullclaw-kuma-push.timer nullclaw-kuma-push.service nullclaw-defib.service 2>/dev/null || true

echo "==> installing & starting opencode-serve + kestrel-discord"
sudo cp "$HERE/systemd/opencode-serve.service" \
        "$HERE/systemd/kestrel-discord.service" \
        "$HERE/systemd/kestrel-kuma-push.service" \
        "$HERE/systemd/kestrel-kuma-push.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-serve.service
for _ in $(seq 1 20); do
  if [ -f "$HOME/.local/state/opencode/service.json" ]; then
    break
  fi
  sleep 1
done
sudo systemctl restart opencode-serve.service
sleep 2
sudo systemctl enable --now kestrel-discord.service kestrel-kuma-push.timer
sudo systemctl restart kestrel-discord.service
echo "==> done! opencode-serve + kestrel-discord active."
