#!/bin/bash
# tetrapod bootstrap — run once as ubuntu on a fresh instance (cloud-init has
# already done tailscale + docker). idempotent-ish: safe to re-run.
#   git clone https://github.com/tetraslam/tetrapod && cd tetrapod
#   ./provision/bootstrap.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- apt: repos

log "apt repos (gh, charm, 1password)"
sudo install -dm755 /etc/apt/keyrings

# github cli
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg |
  sudo tee /etc/apt/keyrings/githubcli.gpg >/dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" |
  sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null

# charm (gum, glow)
curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor --yes -o /etc/apt/keyrings/charm.gpg
echo "deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *" |
  sudo tee /etc/apt/sources.list.d/charm.list >/dev/null

# 1password cli
curl -fsSL https://downloads.1password.com/linux/keys/1password.asc |
  sudo gpg --dearmor --yes -o /etc/apt/keyrings/1password-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" |
  sudo tee /etc/apt/sources.list.d/1password.list >/dev/null

# ------------------------------------------------------------- apt: packages

log "apt packages"
sudo apt-get update
sudo apt-get install -y \
  bash-completion unzip less man-db whois xmlstarlet plocate \
  fd-find ripgrep bat fzf zoxide btop jq tldr chafa \
  git git-lfs just build-essential clang llvm \
  mosh socat netcat-openbsd nmap tcpdump \
  imagemagick ffmpeg \
  smartmontools nvme-cli unattended-upgrades zram-tools \
  restic rsync sqlite3 dnsutils tree \
  gh gum glow 1password-cli \
  python3-venv xz-utils

# ubuntu's debianisms
sudo ln -sf "$(command -v fdfind)" /usr/local/bin/fd
sudo ln -sf "$(command -v batcat)" /usr/local/bin/bat

# ----------------------------------------------------- github release binaries

# install_gh_bin <repo> <asset-regex> <binary-name>
install_gh_bin() {
  local repo="$1" regex="$2" bin="$3" url tmp
  if command -v "$bin" >/dev/null; then log "$bin already installed"; return 0; fi
  url="$(curl -fsSL "https://api.github.com/repos/$repo/releases/latest" |
    jq -r --arg re "$regex" '[.assets[].browser_download_url | select(test($re; "i"))][0] // empty')"
  if [ -z "$url" ]; then
    echo "WARN: no asset matching /$regex/ in $repo — skipping $bin" >&2
    return 0
  fi
  log "$bin  <-  $url"
  tmp="$(mktemp -d)"
  case "$url" in
    *.tar.gz | *.tgz) curl -fsSL "$url" | tar -xz -C "$tmp" ;;
    *.tar.xz) curl -fsSL "$url" | tar -xJ -C "$tmp" ;;
    *.zip) curl -fsSL -o "$tmp/a.zip" "$url" && unzip -q "$tmp/a.zip" -d "$tmp" ;;
    *) curl -fsSL -o "$tmp/$bin" "$url" ;;
  esac
  find "$tmp" -type f -name "$bin" -exec sudo install -m755 {} /usr/local/bin/"$bin" \; -quit
  rm -rf "$tmp"
  command -v "$bin" >/dev/null || echo "WARN: $bin did not land on PATH" >&2
}

log "github release binaries (aarch64)"
install_gh_bin eza-community/eza 'eza_aarch64-unknown-linux-gnu\.tar\.gz$' eza
install_gh_bin bootandy/dust 'aarch64-unknown-linux-gnu\.tar\.gz$' dust
install_gh_bin schollz/croc 'Linux-ARM64\.tar\.gz$' croc
install_gh_bin ekzhang/bore 'aarch64-unknown-linux-musl\.tar\.gz$' bore
install_gh_bin imsnif/bandwhich 'aarch64-unknown-linux-musl\.tar\.gz$' bandwhich
install_gh_bin sxyazi/yazi 'aarch64-unknown-linux-musl\.zip$' yazi
install_gh_bin jj-vcs/jj 'aarch64-unknown-linux-musl\.tar\.gz$' jj
install_gh_bin jesseduffield/lazygit 'Linux_arm64\.tar\.gz$' lazygit
install_gh_bin jesseduffield/lazydocker 'Linux_arm64\.tar\.gz$' lazydocker
install_gh_bin Wilfred/difftastic 'aarch64-unknown-linux-gnu\.tar\.gz$' difft
install_gh_bin typst/typst 'aarch64-unknown-linux-musl\.tar\.xz$' typst
install_gh_bin zellij-org/zellij 'aarch64-unknown-linux-musl\.tar\.gz$' zellij
install_gh_bin openclaw/gogcli 'linux_arm64\.tar\.gz$' gog
install_gh_bin fastfetch-cli/fastfetch 'linux-aarch64\.tar\.gz$' fastfetch # not in noble apt

# helix: tarball ships hx + runtime; keep them together in /opt
if ! command -v hx >/dev/null; then
  log "helix"
  HX_URL="$(curl -fsSL https://api.github.com/repos/helix-editor/helix/releases/latest |
    jq -r '[.assets[].browser_download_url | select(test("aarch64-linux\\.tar\\.xz$"))][0]')"
  tmp="$(mktemp -d)"
  curl -fsSL "$HX_URL" | tar -xJ -C "$tmp"
  sudo rm -rf /opt/helix
  sudo mv "$tmp"/helix-* /opt/helix
  sudo ln -sf /opt/helix/hx /usr/local/bin/hx
  sudo ln -sf /opt/helix/hx /usr/local/bin/helix # arch calls it helix; muscle-memory parity
  rm -rf "$tmp"
fi

# --------------------------------------------------------- installer scripts

log "installer-script tools"
mkdir -p "$HOME/.local/bin"
# starship goes to ~/.local/bin: its installer's `sudo -v` probe trips on the
# %sudo-group password rule even though plain sudo is NOPASSWD here
command -v starship >/dev/null || curl -sS https://starship.rs/install.sh | sh -s -- -y -b "$HOME/.local/bin"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
command -v mise >/dev/null || curl -fsSL https://mise.run | sh
command -v rustup >/dev/null || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
command -v pnpm >/dev/null || curl -fsSL https://get.pnpm.io/install.sh | env SHELL=bash sh -
command -v opencode >/dev/null || curl -fsSL https://opencode.ai/install | bash
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
command -v lain >/dev/null || curl -fsSL https://tetraslam.github.io/lain/install | bash
command -v pulumi >/dev/null || curl -fsSL https://get.pulumi.com | sh

if ! command -v aws >/dev/null; then
  log "aws cli v2"
  tmp="$(mktemp -d)"
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip" -o "$tmp/awscliv2.zip"
  unzip -q "$tmp/awscliv2.zip" -d "$tmp"
  sudo "$tmp/aws/install" --update
  rm -rf "$tmp"
fi

export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:$HOME/.local/share/pnpm/bin:$HOME/.pulumi/bin:$PATH"

# ------------------------------------------------------------------ dotfiles

log "dotfiles"
mkdir -p ~/.config/helix ~/.config/zellij ~/.config/git ~/.config/mise ~/.local/bin
cp "$HERE/dotfiles/bashrc" ~/.bashrc
cp "$HERE/dotfiles/inputrc" ~/.inputrc
cp "$HERE/dotfiles/starship.toml" ~/.config/starship.toml
cp "$HERE/dotfiles/helix/config.toml" ~/.config/helix/config.toml
cp "$HERE/dotfiles/zellij/config.kdl" ~/.config/zellij/config.kdl
cp "$HERE/dotfiles/gitconfig" ~/.config/git/config
cp "$HERE/dotfiles/mise/config.toml" ~/.config/mise/config.toml
sudo install -m755 "$HERE/bin/opa" /usr/local/bin/opa
sudo install -m755 "$HERE/bin/restic-backup" /usr/local/bin/restic-backup
sudo install -m755 "$HERE/bin/shlink" /usr/local/bin/shlink
sudo install -m755 "$HERE/bin/shlink-provision" /usr/local/bin/shlink-provision
sudo install -m755 "$HERE/bin/zipline" /usr/local/bin/zipline
sudo install -m755 "$HERE/bin/media-provision" /usr/local/bin/media-provision
sudo install -m755 "$HERE/bin/media-reconcile" /usr/local/bin/media-reconcile

# ------------------------------------------------------------------ runtimes

log "runtimes via mise (node, bun, zig, zls, go)"
~/.local/bin/mise install --yes || mise install --yes
eval "$(~/.local/bin/mise activate bash --shims)"

log "npm globals + uv tools"
pnpm add -g tree-sitter-cli vercel
uv tool install modal || true

# --------------------------------------------------------------- system tuning

log "zram (8G), journald cap, docker log rotation, unattended-upgrades"
sudo sed -i 's/^#\?ALGO=.*/ALGO=zstd/; s/^#\?SIZE=.*/SIZE=8192/' /etc/default/zramswap
grep -q '^SIZE=8192' /etc/default/zramswap || echo 'SIZE=8192' | sudo tee -a /etc/default/zramswap >/dev/null
sudo systemctl restart zramswap || true

sudo install -dm755 /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' | sudo tee /etc/systemd/journald.conf.d/00-tetrapod.conf >/dev/null
sudo systemctl restart systemd-journald

printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "50m", "max-file": "3" }\n}\n' |
  sudo tee /etc/docker/daemon.json >/dev/null
sudo systemctl restart docker

printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' |
  sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null

# -------------------------------------------------------------- media volume

# 1TB st1 EBS volume from pulumi (tetrapod-media), attached at /dev/sdf →
# /dev/nvme1n1 on nitro. format-once, mount at /srv/media. nofail so a
# detached volume never blocks boot.
log "media volume (/srv/media)"
if [ -b /dev/nvme1n1 ]; then
  if ! blkid /dev/nvme1n1 >/dev/null 2>&1; then
    sudo mkfs.ext4 -m 0 -L media /dev/nvme1n1
  fi
  sudo mkdir -p /srv/media
  grep -q 'LABEL=media' /etc/fstab ||
    echo 'LABEL=media /srv/media ext4 defaults,nofail 0 2' | sudo tee -a /etc/fstab >/dev/null
  sudo systemctl daemon-reload
  mountpoint -q /srv/media || sudo mount /srv/media
  sudo chown tetraslam:tetraslam /srv/media
  mkdir -p /srv/media/{library/{shows,movies,youtube},downloads/{complete,incomplete}}
else
  log "no /dev/nvme1n1 — media volume not attached, skipping"
fi

# ---------------------------------------------------------------- lightpanda

# nightly aarch64 binary (glibc, fine on ubuntu). no auto-update: re-download
# deliberately by deleting the binary and re-running bootstrap.
log "lightpanda CDP server"
if [ ! -x /usr/local/bin/lightpanda ]; then
  curl -fsSL -o /tmp/lightpanda \
    https://github.com/lightpanda-io/browser/releases/download/nightly/lightpanda-aarch64-linux
  sudo install -m755 /tmp/lightpanda /usr/local/bin/lightpanda && rm /tmp/lightpanda
fi
sudo cp "$HERE/systemd/lightpanda.service" "$HERE/systemd/lightpanda-mcp.service" /etc/systemd/system/
sudo cp "$HERE/systemd/searxng-mcp.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lightpanda lightpanda-mcp searxng-mcp

# ------------------------------------------------------------------ nullclaw

# pinned release; bump deliberately. config is rendered from the vault by
# setup-nullclaw.sh (needs opa), so the unit is installed but only started
# once a config exists.
log "nullclaw"
NULLCLAW_VERSION=v2026.5.29
if [ ! -x /usr/local/bin/nullclaw ]; then
  curl -fsSL -o /tmp/nullclaw \
    "https://github.com/nullclaw/nullclaw/releases/download/$NULLCLAW_VERSION/nullclaw-linux-aarch64.bin"
  sudo install -m755 /tmp/nullclaw /usr/local/bin/nullclaw && rm /tmp/nullclaw
fi
sudo cp "$HERE/systemd/nullclaw.service" /etc/systemd/system/
sudo cp "$HERE/systemd/nullclaw-kuma-push.service" "$HERE/systemd/nullclaw-kuma-push.timer" /etc/systemd/system/
sudo systemctl daemon-reload
# timer only fires usefully once kuma-provision has written the push env
[ -f /opt/tetrapod/nullclaw-kuma-push.env ] && sudo systemctl enable --now nullclaw-kuma-push.timer
if [ -f "$HOME/.nullclaw/config.json" ]; then
  sudo systemctl enable --now nullclaw
else
  sudo systemctl enable nullclaw
  echo "nullclaw: no config yet — run provision/setup-nullclaw.sh after opa is in place"
fi

# ------------------------------------------------------------------- backups

log "restic timer"
sudo cp "$HERE/systemd/restic-backup.service" "$HERE/systemd/restic-backup.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now restic-backup.timer

# ------------------------------------------------------------------ services

log "docker compose services"
sudo mkdir -p /opt/tetrapod/factorio
sudo chown -R 845:845 /opt/tetrapod/factorio # factoriotools runs as uid 845
sudo mkdir -p /opt/tetrapod/searxng
sudo chown -R 977:977 /opt/tetrapod/searxng # searxng container uid
# media stack state dirs (uid 1000 across the board)
sudo mkdir -p /opt/tetrapod/{jellyfin/config,jellyfin/cache,qbittorrent,prowlarr,sonarr,radarr,pinchflat} /opt/tetrapod/{zipline/{uploads,public,db},shlink,media-reconcile}
sudo chown -R 1001:1001 /opt/tetrapod/shlink # shlink container uid
sudo chown -R 1000:1000 /opt/tetrapod/{jellyfin,qbittorrent,prowlarr,sonarr,radarr,pinchflat}
sudo chown -R 1000:1000 /opt/tetrapod/media-reconcile
# searxng secret: generate once, survives re-runs
if [ ! -f /opt/tetrapod/searxng.env ]; then
  echo "SEARXNG_SECRET=$(openssl rand -hex 32)" | sudo tee /opt/tetrapod/searxng.env >/dev/null
  sudo chmod 600 /opt/tetrapod/searxng.env
fi
# zipline + shlink secrets: same pattern
if [ ! -f /opt/tetrapod/zipline.env ]; then
  echo "CORE_SECRET=$(openssl rand -hex 32)" | sudo tee /opt/tetrapod/zipline.env >/dev/null
  sudo chmod 600 /opt/tetrapod/zipline.env
fi
if [ ! -f /opt/tetrapod/shlink.env ]; then
  echo "INITIAL_API_KEY=$(openssl rand -hex 24)" | sudo tee /opt/tetrapod/shlink.env >/dev/null
  sudo chmod 600 /opt/tetrapod/shlink.env
fi
# The web client expects the same key under its own variable name. It is exposed
# only on the tailnet; like every browser-only Shlink client, it serves the key
# to authenticated network users.
if ! sudo grep -q '^SHLINK_SERVER_API_KEY=' /opt/tetrapod/shlink.env; then
  SHLINK_KEY="$(sudo sed -n 's/^INITIAL_API_KEY=//p' /opt/tetrapod/shlink.env)"
  printf 'SHLINK_SERVER_API_KEY=%s\n' "$SHLINK_KEY" | sudo tee -a /opt/tetrapod/shlink.env >/dev/null
  unset SHLINK_KEY
fi
# mindustry server jar (pinned release, re-download by deleting the jar)
sudo mkdir -p /opt/tetrapod/mindustry
if [ ! -f /opt/tetrapod/mindustry/server.jar ]; then
  sudo curl -fsSL -o /opt/tetrapod/mindustry/server.jar \
    https://github.com/Anuken/Mindustry/releases/download/v159.7/server-release.jar
fi
sudo docker compose -f "$HERE/docker-compose.yml" up -d
media-provision || echo "WARN: media indexer provisioning failed"
shlink-provision || echo "WARN: service short-link provisioning failed"
sudo cp "$HERE/systemd/media-reconcile.service" "$HERE/systemd/media-reconcile.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now media-reconcile.timer
media-reconcile || echo "WARN: media reconciliation failed"

# code-server at https://tetrapod.<tailnet>.ts.net
sudo tailscale serve --bg 8443 || true

# kuma status api, same-origin for the wiki dashboard (kuma has no CORS)
sudo tailscale serve --bg --set-path /kuma-api http://127.0.0.1:3002 || true

# wiki / home dashboard at https://tetrapod.<tailnet>.ts.net/wiki
REPO="$(cd "$HERE/.." && pwd)"
if [ -d "$REPO/wiki" ]; then
  (cd "$REPO/wiki" && pnpm install --silent && pnpm build >/dev/null) &&
    sudo tailscale serve --bg --set-path /wiki "$REPO/wiki/dist" ||
    echo "WARN: wiki build/serve failed"
  # public copy via funnel on :8443. NEVER funnel 443 — code-server (auth
  # none) lives there and would become a public root shell.
  sudo tailscale funnel --bg --https=8443 --set-path /wiki "$REPO/wiki/dist" || true
  sudo tailscale funnel --bg --https=8443 --set-path /kuma-api http://127.0.0.1:3002 || true
  # zipline + shlink behind i./link.tetraslam.world: vercel host-rewrites to
  # :10000, share-proxy nginx routes by x-forwarded-host
  sudo tailscale funnel --bg --https=10000 http://127.0.0.1:3004 || true
fi

# -------------------------------------------------------------------- agents

# opencode/claude user context (needs gh auth + opa token; fine to fail here,
# the checklist covers running it later)
"$HERE/setup-agents.sh" || echo "setup-agents skipped — run provision/setup-agents.sh after gh auth + opa token"

# --------------------------------------------------------------------- hermes

# TODO: hermes-agent (github.com/nousresearch/hermes-agent) — install details
# live in "still to decide" in the README. clone + uv sync when settled.

# -------------------------------------------------------------------- summary

log "install summary"
export PATH="$HOME/.local/bin:$HOME/.local/share/pnpm:$HOME/.local/share/pnpm/bin:$HOME/.local/share/mise/shims:$HOME/.cargo/bin:$HOME/.pulumi/bin:$HOME/.opencode/bin:$PATH"

EXPECTED=(
  # apt
  unzip less man whois xmlstarlet locate fd rg bat fzf zoxide btop jq tldr chafa
  git git-lfs just gcc clang mosh socat nc nmap tcpdump convert ffmpeg
  smartctl nvme restic rsync sqlite3 dig tree gh gum glow op
  # github releases
  eza dust croc bore bandwhich yazi jj lazygit lazydocker difft typst zellij gog fastfetch hx
  # installer scripts
  starship uv mise cargo pnpm opencode claude lain pulumi aws
  # mise runtimes
  node bun go zig zls
  # pnpm globals + uv tools
  tree-sitter vercel modal
)

MISSING=()
OK=0
for c in "${EXPECTED[@]}"; do
  if command -v "$c" >/dev/null 2>&1; then
    printf '  \033[32mok\033[0m      %s\n' "$c"
    OK=$((OK + 1))
  else
    printf '  \033[1;31mMISSING\033[0m %s\n' "$c"
    MISSING+=("$c")
  fi
done

echo
# service-level checks
check() { # <label> <command...>
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then printf '  \033[32mok\033[0m      %s\n' "$label"
  else printf '  \033[1;31mFAIL\033[0m    %s\n' "$label"; MISSING+=("$label"); fi
}
check "docker: factorio running" sh -c 'sudo docker ps --filter name=factorio --filter status=running -q | grep -q .'
check "docker: code-server running" sh -c 'sudo docker ps --filter name=code-server --filter status=running -q | grep -q .'
check "systemd: restic-backup.timer enabled" systemctl is-enabled restic-backup.timer
check "tailscale: serve active" sh -c 'sudo tailscale serve status | grep -q .'
check "zram active" sh -c 'swapon --show | grep -q zram'
check "dotfiles: starship.toml" test -f "$HOME/.config/starship.toml"
check "dotfiles: helix" test -f "$HOME/.config/helix/config.toml"
check "dotfiles: zellij" test -f "$HOME/.config/zellij/config.kdl"

echo
if [ "${#MISSING[@]}" -eq 0 ]; then
  printf '\033[1;32mall %s tools + services present :D\033[0m\n' "$OK"
else
  printf '\033[1;31m%s ok, %s missing:\033[0m %s\n' "$OK" "${#MISSING[@]}" "${MISSING[*]}"
  echo "re-run ./provision/bootstrap.sh after fixing (idempotent), or install by hand"
fi

# ---------------------------------------------------------------------- done

log "bootstrap done. manual steps remaining:"
cat <<'EOF'
  1. opa token:      (laptop) croc send ~/.config/op/agents-token
                     (here)   mkdir -p ~/.config/op && croc --yes  # then mv into place, chmod 600
  2. restic repo:    create op://Agents/RESTIC_BACKUP_TETRAPOD (access key id /
                     secret access key / repository / repo password / kuma push url)
                     then: sudo restic-backup init && sudo restic-backup
  3. gh auth:        gh auth login
  4. gog auth:       source ~/.bashrc && gog-env
                     gog auth credentials && gog auth add <email> --services gmail,calendar,drive
  5. kuma:           https://lighthouse.<tailnet>.ts.net — add tetrapod ping +
                     factorio rcon-tcp (27015) + code-server http monitors, discord webhook,
                     and a push monitor for restic (url into the op item above)
  6. re-login (or `newgrp docker`) for the docker group to apply
  7. agents:         provision/setup-agents.sh (if it was skipped above), then
                     copy opencode auth: (laptop) croc send ~/.local/share/opencode/auth.json
                     and run `claude` once to log in
  8. nullclaw:       provision/setup-nullclaw.sh (needs opa + op://Agents/
                     NULLCLAW_DISCORD with token/user_id + OPENROUTER_API_KEY)
EOF
