import "@fontsource-variable/inter/wght.css";
import "@fontsource/commit-mono/latin-400.css";
import "@fontsource/commit-mono/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./style.css";

import { TextMorph } from "torph";
import { loadAtlas, onAtlas } from "./atlas";
import { Director } from "./director";
import {
  actionTargets,
  addFeed,
  announce,
  type FeedHooks,
  renderBoard,
  renderBrainStatus,
  renderFactorio,
  renderInspector,
  renderLeaderboard,
  renderLegend,
  renderStock,
  setFeed,
  type Target,
} from "./hud";
import { attachCamera } from "./input";
import { lineColor } from "./lines";
import { MatchView } from "./match";
import { Minimap } from "./minimap";
import { Renderer } from "./renderer";
import { TerrainModel } from "./terrain";
import type { Factorio, FeedItem, Leaderboard, Meta, ServerMessage, State, Terrain } from "./types";
import { $, clock, reducedMotion, setText } from "./util";
import { World } from "./world";

const world = new World();
const view = new Renderer($<HTMLCanvasElement>("map"), world);
const director = new Director(world, view);
const minimap = new Minimap($<HTMLCanvasElement>("minimap"), world, view, (wx, wy) => {
  director.touch(performance.now());
  view.lookAt(wx, wy);
});

let meta: Meta | null = null;
let leaderboard: Leaderboard | null = null;
let factorio: Factorio | null = null;
let lastStateAt = 0;
let socketUp = false;
let everUp = false;
let framed = false;

const matchView = new MatchView(
  () => world.terrain,
  () => meta?.matchId ?? null,
);

const store = {
  get: (k: string, fallback: boolean) => {
    try {
      const v = localStorage.getItem(`arena.${k}`);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  },
  set: (k: string, v: boolean) => {
    try {
      localStorage.setItem(`arena.${k}`, v ? "1" : "0");
    } catch {
      // private mode: the toggle just won't persist
    }
  },
};

// ---------- the admin deck loads only for an admin ----------

type Deck = import("./admin").AdminDeck;
let deck: Deck | null = null;

const boardHooks = () => ({
  admin: !!deck?.on,
  remove: (m: { id: number; model: string; map: string }) =>
    void deck?.remove(m.id, `${m.model} on ${m.map}`),
});
const drawBoard = () => renderLeaderboard(leaderboard, meta, boardHooks());

async function probeAdmin(): Promise<void> {
  try {
    const res = await fetch("/api/admin/me", { redirect: "manual", credentials: "include" });
    if (res.status !== 200) return;
    const { AdminDeck } = await import("./admin");
    deck = new AdminDeck(
      () => {
        void refreshLeaderboard();
      },
      () => meta?.matchId ?? null,
    );
    await deck.probe();
    deck.setMeta(meta);
    if (tab === "leaderboard") drawBoard();
  } catch {
    // stay a spectator
  }
}

// ---------- views ----------

type Tab = "live" | "leaderboard" | "factorio" | "match";
const TABS: Tab[] = ["live", "leaderboard", "factorio"];
let tab: Tab = "live";

function route(): void {
  const hash = location.hash.slice(1);
  const m = hash.match(/^match\/(\d+)(?:\/(\d+))?$/);
  if (m) {
    show("match");
    void matchView.show(Number(m[1]), m[2] ? Number(m[2]) : undefined);
    return;
  }
  show(TABS.includes(hash as Tab) ? (hash as Tab) : "live");
}

function show(next: Tab): void {
  const was = tab;
  tab = next;
  for (const t of [...TABS, "match"] as Tab[]) $(`view-${t}`).hidden = t !== next;
  // A match breakdown lives under the leaderboard, so that tab stays lit.
  for (const t of TABS)
    $(`tab-${t}`).setAttribute(
      "aria-selected",
      String(t === next || (next === "match" && t === "leaderboard")),
    );
  if (was === "match" && next !== "match") matchView.hide();
  if (next === "leaderboard") {
    drawBoard();
    void refreshLeaderboard();
  }
  if (next === "factorio") renderFactorio(factorio, Date.now());
  if (next === "live") view.resize();
}

for (const t of TABS) {
  $(`tab-${t}`).addEventListener("click", () => {
    location.hash = t;
  });
}
window.addEventListener("hashchange", route);
$("tab-leaderboard").addEventListener("pointerenter", () => void refreshLeaderboard(), { passive: true });

// A row in the match table is one big link to its breakdown.
$("matches").addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (target.closest("button, a")) return;
  const href = target.closest<HTMLElement>("tr[data-href]")?.dataset.href;
  if (href) location.hash = href.slice(1);
});

async function refreshLeaderboard(): Promise<void> {
  try {
    leaderboard = (await (await fetch("/api/leaderboard")).json()) as Leaderboard;
    if (tab === "leaderboard") drawBoard();
  } catch {
    // the socket will bring the next one
  }
}

// ---------- camera controls ----------

function setDirector(on: boolean): void {
  director.on = on;
  if (on) director.touch(-1e12);
  $("btnDirector").setAttribute("aria-pressed", String(on));
  store.set("director", on);
}

function setTactical(on: boolean): void {
  view.tactical = on;
  $("btnTactical").setAttribute("aria-pressed", String(on));
  store.set("tactical", on);
  renderLegend(world, on);
}

function frameBase(snap = false): void {
  const core = world.state?.core || world.terrain?.core;
  if (core) view.lookAt(core.x + 0.5, core.y + 0.5, 26, snap);
  else frameMap(snap);
}

function frameMap(snap = false): void {
  if (world.w) view.lookAt(world.w / 2, world.h / 2, view.minZoom(), snap);
}

let spawnTurn = 0;
function frameSpawn(): void {
  const spawns = world.state?.spawns?.length ? world.state.spawns : world.terrain?.spawns || [];
  const sp = spawns[spawnTurn++ % Math.max(1, spawns.length)];
  if (sp) view.lookAt(sp.x + 0.5, sp.y + 0.5, 18);
}

const manual = (fn: () => void) => () => {
  director.touch(performance.now());
  fn();
};

$("btnDirector").addEventListener("click", () => setDirector(!director.on));
$("btnTactical").addEventListener("click", () => setTactical(!view.tactical));
$("btnCore").addEventListener(
  "click",
  manual(() => frameBase()),
);
$("btnFit").addEventListener(
  "click",
  manual(() => frameMap()),
);
$("btnSpawn").addEventListener("click", manual(frameSpawn));
$("btnIn").addEventListener(
  "click",
  manual(() => view.zoomAt(view.width / 2, view.height / 2, 1.45)),
);
$("btnOut").addEventListener(
  "click",
  manual(() => view.zoomAt(view.width / 2, view.height / 2, 1 / 1.45)),
);

attachCamera(view, () => director.touch(performance.now()));

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target as HTMLElement;
  if (el.closest("input, textarea, select, [role=dialog], [role=alertdialog], [role=listbox]")) return;
  const key = e.key.toLowerCase();
  if (key >= "1" && key <= "3") {
    location.hash = TABS[Number(key) - 1];
    return;
  }
  if (tab === "match") {
    if (el.closest("button") && key === " ") return;
    if (matchView.key(e)) e.preventDefault();
    return;
  }
  if (tab !== "live") return;
  const pan = 90;
  const moves: Record<string, () => void> = {
    d: () => setDirector(!director.on),
    t: () => setTactical(!view.tactical),
    c: manual(() => frameBase()),
    f: manual(() => frameMap()),
    s: manual(frameSpawn),
    "+": manual(() => view.zoomAt(view.width / 2, view.height / 2, 1.3)),
    "=": manual(() => view.zoomAt(view.width / 2, view.height / 2, 1.3)),
    "-": manual(() => view.zoomAt(view.width / 2, view.height / 2, 1 / 1.3)),
    arrowleft: manual(() => view.panBy(pan, 0)),
    arrowright: manual(() => view.panBy(-pan, 0)),
    arrowup: manual(() => view.panBy(0, pan)),
    arrowdown: manual(() => view.panBy(0, -pan)),
    escape: () => {
      view.selected = null;
    },
  };
  const move = moves[key];
  if (move) {
    e.preventDefault();
    move();
  }
});

// ---------- the feed talks to the map ----------

function jumpTo(targets: Target[]): void {
  if (!targets.length) return;
  const now = performance.now();
  for (const t of targets) world.ping(t.x, t.y, t.ok, now);
  const x = targets.reduce((a, t) => a + t.x, 0) / targets.length + 0.5;
  const y = targets.reduce((a, t) => a + t.y, 0) / targets.length + 0.5;
  director.jump(x, y, now, 30);
  if (matchMedia("(max-width: 900px)").matches)
    $("stage").scrollIntoView({ block: "start", behavior: "smooth" });
}

const feedHooks: FeedHooks = {
  jump: jumpTo,
  // The feed can hold the tail of the last match too, so a turn is matched to its match by time.
  turnHref: (item) => {
    const rows = leaderboard?.recentMatches || [];
    const row = rows.find((m) => m.started_at <= item.ts && (!m.ended_at || item.ts <= m.ended_at + 3000));
    const id = row?.id ?? (item.ts >= (rows[0]?.started_at ?? 0) ? meta?.matchId : null);
    return id && item.seq ? `#match/${id}/${item.seq}` : null;
  },
};

function onFeed(item: FeedItem): void {
  if (!addFeed(item, feedHooks)) return;
  const now = performance.now();
  for (const a of item.actions || []) for (const t of actionTargets(a)) world.ping(t.x, t.y, t.ok, now);
  if (item.seq) matchView.refresh();
}

// ---------- match events ----------

const ticker = () => meta?.contender.id || "";

world.events.built = (views) => director.built(views, performance.now());
world.events.wave = (wave, state) =>
  announce(`wave ${wave}`, state.enemies ? `${state.enemies} hostiles on the field` : "inbound", "hostile");
world.events.gameOver = (state) =>
  announce("core lost", `${ticker()} went out on wave ${state.wave}`, "hostile");
world.events.newMap = (state) => {
  director.reset();
  framed = false;
  announce(state.map, `${ticker()} drops in`, "plain");
  void refreshLeaderboard();
};

// ---------- data in ----------

function onTerrain(t: Terrain | null): void {
  if (!t?.ready) return;
  if (world.terrain?.map === t.map && world.terrain.w === t.width) return;
  world.setTerrain(new TerrainModel(t));
  framed = false;
  renderLegend(world, view.tactical);
}

function onMeta(m: Meta | null): void {
  if (!m) return;
  meta = m;
  view.callsign = m.contender.id;
  view.callsignColor = lineColor(m.contender.id);
  deck?.setMeta(m);
}

function onState(state: State | null, m: Meta | null): void {
  onMeta(m);
  if (!state?.ready) return;
  lastStateAt = performance.now();
  world.apply(state, lastStateAt);
  if (!framed && world.terrain && world.terrain.map === state.map) {
    framed = true;
    view.resize();
    frameBase(true);
    $("waiting").setAttribute("data-gone", "");
  }
  if (tab === "live") {
    renderBoard(state, meta);
    renderStock(state);
  }
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case "init":
      onTerrain(msg.terrain);
      if (msg.leaderboard) leaderboard = msg.leaderboard;
      if (msg.feed) setFeed(msg.feed, feedHooks);
      if (msg.factorio) factorio = msg.factorio;
      onState(msg.state, msg.meta);
      renderBoard(world.state, meta);
      renderStock(world.state);
      if (tab === "leaderboard") drawBoard();
      break;
    case "terrain":
      onTerrain(msg.terrain);
      break;
    case "state":
      onState(msg.state, msg.meta);
      break;
    case "feed":
      onFeed(msg.item);
      break;
    case "leaderboard":
      leaderboard = msg.leaderboard;
      if (tab === "leaderboard") drawBoard();
      break;
    case "factorio":
      factorio = msg.factorio;
      break;
    case "config":
      onMeta(msg.meta);
      if (msg.leaderboard) leaderboard = msg.leaderboard;
      deck?.onConfig(msg.config);
      if (tab === "leaderboard") drawBoard();
      break;
  }
}

let retry = 0;
function connect(): void {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
  ws.onopen = () => {
    socketUp = true;
    everUp = true;
    retry = 0;
  };
  ws.onmessage = (ev) => {
    const t = performance.now();
    try {
      handle(JSON.parse(ev.data) as ServerMessage);
      spent("data", t);
    } catch (err) {
      console.error("bad arena message", err);
    }
  };
  ws.onclose = () => {
    socketUp = false;
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 600 * retry);
  };
  ws.onerror = () => ws.close();
}

// ---------- the loop ----------
// One requestAnimationFrame loop draws whichever map is on screen. DOM updates ride a slow
// 4hz tick (or arrive with data at 3hz), so the canvas never waits on layout.

const caption = $("directorLabel");
const captionText = caption.appendChild(document.createElement("span"));
const morph = reducedMotion()
  ? null
  : new TextMorph({ element: captionText, duration: 320, ease: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
let captionNow = "";
let slowAt = 0;
let inspectAt = 0;

// Worst time spent in each part of the page since the last arena.perf() call, in ms.
const worst = { sim: 0, draw: 0, minimap: 0, dom: 0, data: 0 };
const spent = (key: keyof typeof worst, since: number) => {
  const ms = performance.now() - since;
  if (ms > worst[key]) worst[key] = ms;
};

function loop(now: number): void {
  if (!document.hidden) {
    if (tab === "live") {
      let t = performance.now();
      world.terrain?.stepLow(4);
      world.tick(now);
      director.update(now);
      spent("sim", t);
      t = performance.now();
      view.frame(now);
      spent("draw", t);
      t = performance.now();
      minimap.draw(now);
      spent("minimap", t);
      if (now - inspectAt > 100) {
        inspectAt = now;
        t = performance.now();
        renderInspector(world, view.hover || view.selected);
        spent("dom", t);
      }
    } else if (tab === "match") {
      const t = performance.now();
      matchView.frame(now);
      spent("draw", t);
    }
  }
  if (now - slowAt > 250) {
    slowAt = now;
    const t = performance.now();
    slowTick(now);
    spent("dom", t);
  }
  requestAnimationFrame(loop);
}

function slowTick(now: number): void {
  setText($("clock"), clock(Date.now()));
  // Nothing is said while the stream is healthy. Only trouble gets a word.
  const age = lastStateAt ? (now - lastStateAt) / 1000 : 0;
  const trouble =
    !socketUp && everUp
      ? "reconnecting"
      : socketUp && lastStateAt && age > 4
        ? `no data for ${Math.round(age)}s`
        : "";
  const el = $("trouble");
  el.hidden = !trouble;
  setText(el, trouble);

  if (tab === "live") {
    renderBrainStatus(world.state, meta, now);
    // The countdown that "yours for 0:39" runs is plain text. Shot names morph.
    const label = director.label;
    if (label !== captionNow) {
      captionNow = label;
      caption.hidden = !label;
      if (morph && !/^yours for/.test(label)) morph.update(label);
      else captionText.textContent = label;
    }
  } else if (tab === "factorio") renderFactorio(factorio, Date.now());
  else if (tab === "match") matchView.tick();
}

// A handle for poking at the live match from the console. arena.perf() reports frame times.
const perf = () => {
  const out = {
    ...view.perf(),
    worst: {
      ...Object.fromEntries(Object.entries(worst).map(([k, v]) => [k, +v.toFixed(1)])),
      terrain: +view.terrainWorst.toFixed(1),
      bake: +(world.terrain?.bakeWorst ?? 0).toFixed(1),
    },
  };
  for (const k of Object.keys(worst) as Array<keyof typeof worst>) worst[k] = 0;
  view.terrainWorst = 0;
  if (world.terrain) world.terrain.bakeWorst = 0;
  return out;
};
Object.assign(window, { arena: { world, view, director, perf } });

// ?perf=<url> posts frame-time stats there every few seconds, for measuring a browser from outside it.
const perfSink = new URLSearchParams(location.search).get("perf");
if (perfSink) {
  setInterval(() => {
    navigator.sendBeacon(perfSink, JSON.stringify({ ua: navigator.userAgent, tab, ...perf() }));
  }, 4000);
}

setDirector(store.get("director", true));
setTactical(store.get("tactical", false));
route();
onAtlas(() => renderStock(world.state));
void loadAtlas();
connect();
void probeAdmin();
requestAnimationFrame(loop);
