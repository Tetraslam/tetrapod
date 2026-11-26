---
name: tetrapod-media
description: Manage tetrapod's media stack (Jellyfin, Sonarr, Radarr, Bazarr, Prowlarr, qBittorrent, Suwayomi, Pinchflat, Seerr) and verify library imports.
---

# Tetrapod Media Stack

All services run locally via Docker Compose on tetrapod (`/opt/tetrapod` state, `/srv/media` 4TB volume).

## Local APIs & Keys

- **Sonarr** (`http://127.0.0.1:8989/api/v3`): API key in `/opt/tetrapod/sonarr/config.xml` (`xmlstarlet sel -t -v /Config/ApiKey /opt/tetrapod/sonarr/config.xml`)
- **Radarr** (`http://127.0.0.1:7878/api/v3`): API key in `/opt/tetrapod/radarr/config.xml`
- **Prowlarr** (`http://127.0.0.1:9696/api/v1`): API key in `/opt/tetrapod/prowlarr/config.xml`
- **qBittorrent** (`http://127.0.0.1:8081/api/v2`): no local auth on loopback — works directly from OpenCode Code Mode automations via `fetch("http://127.0.0.1:8081/api/v2/torrents/info")` with zero secrets!
- **Jellyfin** (`http://127.0.0.1:8096`): API key in `sqlite3 /opt/tetrapod/jellyfin/config/data/jellyfin.db "SELECT AccessToken FROM ApiKeys ORDER BY Id LIMIT 1;"`. Authenticate with header `Authorization: MediaBrowser Token="<key>"` (do NOT use `X-Emby-Token`, which returns 401 on Jellyfin 12).
- **Suwayomi** (`http://127.0.0.1:4567/api/graphql`): GraphQL API for manga library/downloads
- **Bazarr** (`http://127.0.0.1:6767`), **Seerr** (`http://127.0.0.1:5055`), **Pinchflat** (`http://127.0.0.1:8945`)

## Workflows

- **Adding shows/movies**: search via Sonarr `/series/lookup` or Radarr `/movie/lookup`, add with root folder (`/srv/media/library/shows` or `/srv/media/library/movies`), profile `Standard` (or `Cinema` if shresht asks for 4K/remux), and `searchForMissingEpisodes: true` / `searchForMovie: true`.
- **Verifying delivery**: check qBittorrent progress -> Sonarr/Radarr queue & file count -> trigger Jellyfin refresh (`POST /Library/Refresh`) if needed. For zero-model-cost download watchers, use a Code Mode automation (`action: { type: "code" }`) that calls `fetch("http://127.0.0.1:8081/api/v2/torrents/info")` every few minutes (no API key needed!), and only wakes the session (`return { done: true, send: { prompt: "..." } }`) once the torrent hits `progress >= 1` so you can verify import and Jellyfin visibility!
- **Storage hygiene**: `media-warden --dry-run` previews storage actions; `media-reconcile` runs on exponential backoff for missing items.
