# arena web

the spectator page at arena.tetraslam.world. it draws the live mindustry match with the game's own v159.7 sprites, shows what the model is thinking, and has the standings and the factorio server's pulse.

```sh
bun install
bun run dev     # serves on :5173 and proxies /api, /ws and /sprites to the live arena
bun run build   # typechecks, then writes dist/
bun run check   # typecheck + biome
```

`provision/setup-arena.sh` builds this on tetrapod and copies `dist/` to `/opt/tetrapod/arena/web`, where `server/index.ts` serves it.

## stack

- vite + typescript, no framework. the page is one canvas and a few panels, so the dom is built by hand in `src/hud.ts`.
- bun for installs and scripts, because it's the runtime tetrapod already has. the lockfile is `bun.lock`.
- biome for lint and format.
- fonts self-hosted through fontsource: barlow condensed (display), inter (reading), commit mono (tickers and numbers).
- the look is decided in [BRIEF.md](BRIEF.md). read it before changing anything visual.

## where things are

| file | what it does |
| --- | --- |
| `src/atlas.ts` | loads `/sprites/atlas.json` and its pages, draws and tints regions |
| `src/terrain.ts` | decodes the map, bakes sprite chunks at three levels of detail, finds enemy routes |
| `src/world.ts` | turns 3hz snapshots into smooth things: interpolated units, belt items, tracers, explosions |
| `src/renderer.ts` | camera and every draw call |
| `src/director.ts` | the auto camera: fights, then new construction, then a tour |
| `src/minimap.ts` | the corner map |
| `src/hud.ts` | board, feed, inspector, leaderboard and factorio pages |
| `src/lines.ts` | each model's line colour and disc |

`window.arena` holds the world, view and director if you want to poke at a live match from the console.
