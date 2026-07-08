#!/bin/bash
# setup-agents — give opencode + claude code full user context on tetrapod.
# Idempotent; re-run anytime to refresh memory from the laptop (via rice).
# Requires: gh auth (rice is private) + the opa token in place.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
MEM="$HOME/.claude/projects/-home-tetraslam/memory"
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

gh auth status >/dev/null 2>&1 || { echo "setup-agents: needs 'gh auth login' first (rice is private)"; exit 1; }
opa vault list >/dev/null 2>&1 || { echo "setup-agents: needs the opa token in place first"; exit 1; }

# personal memory lives in the private rice repo (this repo is public)
if [ -d "$HOME/rice/.git" ]; then
  git -C "$HOME/rice" pull -q
else
  gh repo clone tetraslam/rice "$HOME/rice" -- -q
fi

mkdir -p "$MEM" "$HOME/.config/opencode" "$HOME/.claude/skills"

# laptop-canonical memory subset (portable files only; wifi/system-setup/
# obsidian/sudo are laptop-specific, 1password is replaced by our adapted one)
for f in user_profile user_deep_profile feedback_style feedback_software_recs \
  project_software_recs reference_homelab; do
  cp "$HOME/rice/claude/memory/$f.md" "$MEM/"
done

# tetrapod-specific memory (overwrites MEMORY.md index + 1password with the
# box-adapted versions)
cp "$HERE/agent/memory/"*.md "$MEM/"

# portable skills
for s in session-export tigris; do
  [ -d "$HOME/rice/claude/skills/$s" ] && cp -r "$HOME/rice/claude/skills/$s" "$HOME/.claude/skills/"
done

# one instructions file, symlinked into both agents (git pull updates it live)
ln -sf "$REPO/provision/agent/AGENTS.md" "$HOME/.config/opencode/AGENTS.md"
ln -sf "$REPO/provision/agent/AGENTS.md" "$HOME/.claude/CLAUDE.md"
cp "$HERE/agent/claude-settings.json" "$HOME/.claude/settings.json"

# opencode config: render the firecrawl key from the vault (never committed)
FIRECRAWL_KEY="$(opa read 'op://Agents/FIRECRAWL_API_KEY/credential')"
sed "s/__FIRECRAWL_API_KEY__/$FIRECRAWL_KEY/" "$HERE/agent/opencode.json.template" \
  > "$HOME/.config/opencode/opencode.json"
chmod 600 "$HOME/.config/opencode/opencode.json"
cp "$HERE/agent/opencode-package.json" "$HOME/.config/opencode/package.json"
(cd "$HOME/.config/opencode" && bun install --silent) || echo "WARN: bun install failed; opencode will retry plugin install on first run"

echo "setup-agents: done. remaining (one-time, interactive):"
echo "  - opencode: croc ~/.local/share/opencode/auth.json from the laptop (or 'opencode auth login')"
echo "  - claude:   run 'claude' once and log in"
echo "notes vs laptop config: litellm provider removed (proxy on the other"
echo "tailnet, unreachable from here), claude-peers removed (laptop-side repo),"
echo "playwright mcp disabled until chromium is installed"
