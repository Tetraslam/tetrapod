# TOOLS

## Repositories

- The tetrapod infrastructure repository is `/home/tetraslam/tetrapod`.
- Use `git_operations` with that absolute path as `cwd` when inspecting its
  status, history, branches, or changes.

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
