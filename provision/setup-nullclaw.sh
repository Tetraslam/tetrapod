#!/bin/bash
# setup-nullclaw — render nullclaw config from the vault and (re)start it.
# Idempotent; re-run after vault or template changes.
# Requires: opa token in place, nullclaw binary + units installed (bootstrap).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

opa vault list >/dev/null 2>&1 || { echo "setup-nullclaw: needs the opa token first"; exit 1; }

OPENROUTER_KEY="$(opa read 'op://Agents/OpenRouter API Key - experiments/credential')"
FIRECRAWL_KEY="$(opa read 'op://Agents/FIRECRAWL_API_KEY/credential')"
DISCORD_TOKEN="$(opa read 'op://Agents/NULLCLAW_DISCORD/credential')"
DISCORD_USER_ID="$(opa read 'op://Agents/NULLCLAW_DISCORD/username')"

mkdir -p "$HOME/.nullclaw"
sed -e "s|__OPENROUTER_API_KEY__|$OPENROUTER_KEY|" \
    -e "s|__FIRECRAWL_API_KEY__|$FIRECRAWL_KEY|" \
    -e "s|__DISCORD_BOT_TOKEN__|$DISCORD_TOKEN|" \
    -e "s|__DISCORD_USER_ID__|$DISCORD_USER_ID|" \
    "$HERE/nullclaw/config.json.template" > "$HOME/.nullclaw/config.json"
chmod 600 "$HOME/.nullclaw/config.json"

nullclaw doctor || true
sudo systemctl restart nullclaw
echo "setup-nullclaw: done. check: nullclaw status && journalctl -u nullclaw -n 20"
