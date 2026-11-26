---
name: tetrapod-ops
description: Operate tetrapod and lighthouse infrastructure (Docker Compose, Caddy, Authelia, systemd timers, Uptime Kuma, restic backups, MIT Mail proxy, Vercel DNS).
---

# Tetrapod Ops

- Repo lives at `~/tetrapod`. Always edit tracked files in `~/tetrapod/provision/`, apply live, commit, and push.
- **Docker services**: `sudo docker compose -f ~/tetrapod/provision/docker-compose.yml up -d`
- **Caddy reload**: `sudo docker exec provision-caddy-1 caddy reload --config /etc/caddy/Caddyfile`
- **Backups**: nightly `restic-backup.timer` to Tigris (`sudo restic-backup snapshots` to inspect).
- **Monitoring**: Uptime Kuma runs on `lighthouse` (`ssh tetraslam@lighthouse`, `https://lighthouse.tailc27667.ts.net`). Manage monitors via `~/tetrapod/provision/bin/kuma-provision`.
- **MIT Mail**: `email-oauth2-proxy.service` (IMAP `:1993`) + `mit-graph-smtp.service` (SMTP `:1465`) + `mit-mail-kuma-push.timer` (alerts Discord on token expiry). Re-auth helpers: `mit-imap-authorize` and `sudo -u tetraslam -H mit-graph-smtp authorize`.
- **DNS**: `tetraslam.world` is on Vercel DNS (`vercel dns ls tetraslam.world`).
- **Hard rules**: never touch AWS Bedrock/IAM; never break Tailscale.
