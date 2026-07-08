---
name: reference_1password
description: Secrets on tetrapod — opa (Agents vault, read-only) is the only 1Password access here
type: reference
---

# 1Password on tetrapod — `opa` only

This box has the `op` CLI but **no desktop app, no Personal vault, no
`op signin`**. The only access is `opa` (`/usr/local/bin/opa`): a read-only
service account scoped to the **Agents** vault, token at
`~/.config/op/agents-token` (600). It works promptless everywhere — ssh,
cron, systemd.

```bash
opa read "op://Agents/<item>/<field>"    # field: usually credential or password
opa item list --vault Agents             # what exists
opa item get "<item>" --format json | jq '.fields[] | {label, type}'
```

## Items that matter on this box

- `FIRECRAWL_API_KEY`, `MORPHLLM_API_KEY`, `ANTHROPIC_API_KEY`, OpenRouter — API keys (field `credential`)
- `RESTIC_BACKUP_TETRAPOD` — tigris keys, repo, repo password, kuma push url (used by `restic-backup`)
- `GOG_KEYRING` — password for gog's file keyring (the `gog-env` shell function exports it)
- `TETRAPOD_PULUMI` / `TETRAPOD_TIGRIS` — pulumi state passphrase + tigris state-bucket key (mostly used laptop-side)

## Rules

- Never write a resolved secret to a file, a committed `.env`, or a log. Only
  `op://` *references* are safe to commit. **This repo is public** — doubly so.
- Keep secrets in pipes or per-command env vars, not exported globals or shell
  history.
- sudo is passwordless here; no password dance needed.
- If something needs a secret that isn't in the Agents vault, ask tetraslam to
  add it there (he does it from the laptop) — there is no workaround on this box.
