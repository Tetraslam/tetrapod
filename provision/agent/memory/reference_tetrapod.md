---
name: reference_tetrapod
description: The machine you are running on — services, paths, hard rules, resource budget
type: reference
---

# tetrapod — this machine

Persistent AWS VM (`t4g.xlarge`, 4 vcpu Graviton2, 16GB, us-west-2), Ubuntu
24.04 **arm64** — x86-only binaries won't run here. User `tetraslam` (uid 1000,
passwordless sudo). On the tailnet `tailc27667.ts.net` with tailscale-ssh; no
public ingress except tailscale's wireguard port. Everything about this box is
IaC'd in `~/tetrapod` (public repo, github.com/tetraslam/tetrapod).

## Hard rules

1. **Never touch AWS Bedrock or Bedrock-related IAM** — via aws cli, pulumi,
   anything. tetraslam runs Claude models from there; breaking it is a
   fire-everything offense.
2. **Don't break tailscale.** It is the only door (fallback: SSM/serial
   console, laptop-side). No `tailscale down`, no firewall experiments.
3. **Don't casually restart the factorio container.** Friends play on it.
   Ask, or check for players first (`sudo docker exec provision-factorio-1
   rcon /players online` style; rcon pw in /opt/tetrapod/factorio/config/rconpw).
4. **System changes go through the repo** (`~/tetrapod/provision/`), then get
   applied. Ad-hoc config drift kills reproducibility. Commit what you change.
5. Downtime is *observed*: uptime-kuma on the sibling box pages discord if
   this machine, factorio, or code-server goes dark.

## Services

| what | where | notes |
|------|-------|-------|
| factorio | docker `provision-factorio-1`, udp 34197 + rcon tcp 27015 | tailnet-only, 4G mem cap, data `/opt/tetrapod/factorio` |
| code-server | docker, `https://tetrapod.tailc27667.ts.net` via tailscale serve | localhost:8443 → container |
| restic backups | `restic-backup` (system timer, 10:00 UTC nightly) | → tigris, pings kuma push monitor on success |
| uptime-kuma | NOT here — on sibling box `lighthouse` (t4g.micro, cloud-init only) | `https://lighthouse.tailc27667.ts.net` |

## Paths & tools

- `~/tetrapod` — the repo: `infra/` (pulumi, python/uv) + `provision/`
  (bootstrap.sh idempotent, docker-compose.yml, dotfiles, this file)
- `/opt/tetrapod/` — compose service data (backed up nightly)
- `/usr/local/bin` — github-release binaries (eza, jj, lazygit, difft, hx/helix, ...)
- runtimes via mise (node/bun/zig/zls/go), python via uv, rust via rustup
- `restic-backup snapshots` / `restic-backup restore <snap> --target <dir>` (root)
- gog (google workspace cli): two accounts — work = default client, personal =
  `--client personal`. Run `gog-env` first (file keyring, password via opa).
- aws cli uses the instance role: SSM-only permissions. Real AWS changes happen
  through pulumi **from the laptop** (state on tigris, passphrase via opa).

## Resource budget

16GB ram total: factorio capped at 4G, code-server 2G, zram swap 8G. Burstable
CPU (t4g unlimited): sustained 100%-on-all-cores costs extra money — fine in
bursts, don't peg it for days without asking.

## Secrets

`opa read "op://Agents/<item>/<field>"` — read-only service account, Agents
vault only. There is NO desktop app, NO Personal vault, NO `op signin` here.
If a secret isn't in the Agents vault, ask tetraslam. Details:
@~/.claude/projects/-home-tetraslam/memory/reference_1password.md

## Sibling: lighthouse

`t4g.micro` running uptime-kuma only, fully managed by cloud-init in
`~/tetrapod/infra/__main__.py` — no bootstrap, no rice. If it needs changes,
change the IaC.
