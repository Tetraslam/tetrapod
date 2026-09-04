# TOOLS

## Repositories

- The tetrapod infrastructure repository is `/home/tetraslam/tetrapod`.
- Use `git_operations` with that absolute path as `cwd` when inspecting its
  status, history, branches, or changes.

## Nullclaw runtime

- The installed Nullclaw fork commit is recorded in
  `/usr/local/share/nullclaw-commit`. This is distinct from the tetrapod
  infrastructure repository commit.
- Check the service with `systemctl is-active nullclaw` and its gateway with
  `curl -fsS http://127.0.0.1:3000/health`.
- Shell commands run through `/bin/sh`. Use `bash -lc '...'` when a command needs
  Bash-only features such as `set -o pipefail`.

## Durable follow-ups

- `schedule` is the authority for work that must continue after a chat turn.
  Successful creation returns a job ID; verify it with `schedule action=get`
  before saying a watcher is running.
- For condition-based work, use `schedule action=once` with an agent `prompt`,
  initial `delay`, `repeat_delay`, and `session_target=isolated`. The scheduler
  re-arms pending, incomplete, empty, or failed runs automatically. Do not put a
  `message`, notification, or successor-scheduling instruction in the watcher
  prompt. It returns only the check result and terminal marker; the scheduler
  delivers verified terminal output and removes the job.
- Scheduler management uses `schedule` actions `list`, `get`, `update`, `pause`,
  `resume`, and `remove`. Empty optional fields are ignored. After every mutation,
  use `get` or `list` to verify the live daemon state before reporting success.

## Media requests

- Sonarr and Radarr additions are reconciled automatically within one minute.
- The enforced quality floor is 1080p; 2160p upgrades are allowed. Never select
  or manually add a 720p release.
- Do not report that media is downloading until it appears in Sonarr/Radarr's
  queue or qBittorrent. If no acceptable release is found, say that explicitly.

## Phone notifications

- The `ntfy_publish_message` MCP tool sends rich notifications to Shresht's
  Android phone. Its server, topic, and scoped token are already configured.
- Read `skills/notify/SKILL.md` before shaping a notification. Use it when
  Shresht asks to be notified, when long autonomous work finishes or fails, or
  when you are blocked awaiting input while he is away.
- Do not spam routine progress. Never use emoji or `--tags` in notifications.
  Prefer one useful notification with priority and a direct `--click` target.
  Run `notify --help` for all fields.
