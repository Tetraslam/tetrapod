---
name: tetrapod-arena
description: Inspect, control, or switch contenders in the tetrapod AI Game Arena (Mindustry + Factorio spectator stream at https://arena.tetraslam.world).
---

# Tetrapod AI Game Arena

The Arena runs locally at `http://127.0.0.1:6570` and streams publicly at `https://arena.tetraslam.world`.

## Local API (`http://127.0.0.1:6570`)

- `GET /api/state` — current live Mindustry match state, active AI contender, wave, core HP, resources, recent reasoning log, and Factorio telemetry.
- `GET /api/leaderboard` — match history and per-model stats (best wave, average wave, total matches, blocks built).
- `POST /api/control` — control the arena runner:
  - `{"action": "pause"}` / `{"action": "resume"}`
  - `{"action": "new_match", "map": "Fortress", "model": "claude-agent/sonnet"}`
  - `{"action": "set_model", "model": "openrouter/google/gemini-4-neon"}`
  - `{"action": "send_wave"}`
- `POST /api/factorio/rcon` — `{"command": "/players"}` (run read-only or controlled Factorio RCON commands).
- Systemd unit: `tetrapod-arena.service` (`journalctl -u tetrapod-arena -f`).
