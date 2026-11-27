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
  renderOffAir,
  renderPlan,
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
import type { Factorio, FeedItem, Leaderboard, Meta, PlanGoal, ServerMessage, State, Terrain } from "./types";
import { $, clock, reducedMotion, setText } from "./util";
import { World } from "./world";

const world = new World();
const view = new Renderer($<HTMLCanvasElement>("map"), world);
const director = new Director(world, view);
const minimap = new Minimap($<HTMLCanvasElement>("minimap"), world, view, (wx, wy) => {
  setCamera("free");
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
  () => ({
    on: !!deck?.on,
    confirm: (title, detail, yes) => deck?.confirm(title, detail, yes) ?? Promise.resolve(false),
  }),
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
const drawOffAir = () => renderOffAir(leaderboard, meta, boardHooks(), Date.now());
const offAir = () => meta?.matchState === "idle";

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
    matchView.adminChanged();
    if (tab === "leaderboard") drawBoard();
    if (offAir()) drawOffAir();
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
  const m = hash.match(/^match\/(\d+)(?:\/(\d+|interview))?$/);
  if (m) {
    show("match");
    const talk = m[2] === "interview";
    void matchView.show(Number(m[1]), m[2] && !talk ? Number(m[2]) : undefined, talk);
    return;
  }
  show(TABS.includes(hash as Tab) ? (hash as Tab) : "live");
}

function show(next: Tab): void {
  const was = tab;
  tab = next;
  for (const t of [...TABS, "match"] as Tab[]) $(`view-${t}`).hidden = t !== next;
  syncAir();
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

/** Off air, the live tab shows the intermission board in place of the battlefield. */
function syncAir(): void {
  const idle = offAir();
  $("view-live").hidden = tab !== "live" || idle;
  $("view-offair").hidden = tab !== "live" || !idle;
  if (idle && tab === "live") drawOffAir();
}

for (const id of ["matches", "offMatches"]) {
  // A row in a match table is one big link to its breakdown.
  $(id).addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a")) return;
    const href = target.closest<HTMLElement>("tr[data-href]")?.dataset.href;
    if (href) location.hash = href.slice(1);
  });
}
$("offStart").addEventListener("click", () => deck?.open());

for (const t of TABS) {
  $(`tab-${t}`).addEventListener("click", () => {
    location.hash = t;
  });
}
window.addEventListener("hashchange", route);
$("tab-leaderboard").addEventListener("pointerenter", () => void refreshLeaderboard(), { passive: true });

async function refreshLeaderboard(): Promise<void> {
  try {
    leaderboard = (await (await fetch("/api/leaderboard")).json()) as Leaderboard;
    if (tab === "leaderboard") drawBoard();
    if (offAir() && tab === "live") drawOffAir();
  } catch {
    // the socket will bring the next one
  }
}

// ---------- camera ----------
// Exactly one of three things drives the camera: it follows the builder ship, the director
// cuts between events, or it stays where the viewer put it. Dragging or jumping picks "free".

type CameraMode = "follow" | "director" | "free";
let camera: CameraMode = "follow";

function setCamera(mode: CameraMode): void {
  if (mode === camera) return;
  camera = mode;
  for (const [id, m] of [
    ["camFollow", "follow"],
    ["camDirector", "director"],
    ["camFree", "free"],
  ] as const)
    $(id).setAttribute("aria-checked", String(m === mode));
  view.ease = mode === "follow" ? 0.1 : 0.08;
  if (mode === "director") director.reset();
  // "free" is where a drag leaves you, so it is never what a reload starts in.
  if (mode !== "free") {
    try {
      localStorage.setItem("arena.camera", mode);
    } catch {
      // private mode
    }
  }
}

/** Keep the builder ship in the middle of the picture. Zoom is the viewer's to set. */
function followShip(): string {
  const ship = world.units.get(world.droneId);
  const core = world.state?.core;
  if (ship) {
    view.goal.x = ship.x;
    view.goal.y = world.h - ship.y;
    const b = world.build;
    return b ? `the builder ship, placing ${b.block}` : "the builder ship";
  }
  if (core) {
    view.goal.x = core.x + 0.5;
    view.goal.y = world.h - core.y - 0.5;
    return "the core, until the builder ship is out";
  }
  return "";
}

function setTactical(on: boolean): void {
  view.tactical = on;
  $("btnTactical").setAttribute("aria-checked", String(on));
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

/** A one-shot jump: the camera goes there once and is then the viewer's. */
const jump = (fn: () => void) => () => {
  setCamera("free");
  fn();
};

/** Zoom about the centre. Following keeps following; the director gives the camera up, since it sets its own zoom. */
const zoom = (factor: number) => () => {
  if (camera === "director") setCamera("free");
  view.zoomAt(view.width / 2, view.height / 2, factor);
};

$("camFollow").addEventListener("click", () => setCamera("follow"));
$("camDirector").addEventListener("click", () => setCamera("director"));
$("camFree").addEventListener("click", () => setCamera("free"));
$("btnTactical").addEventListener("click", () => setTactical(!view.tactical));
$("btnCore").addEventListener(
  "click",
  jump(() => frameBase()),
);
$("btnFit").addEventListener(
  "click",
  jump(() => frameMap()),
);
$("btnSpawn").addEventListener("click", jump(frameSpawn));
$("btnIn").addEventListener("click", zoom(1.45));
$("btnOut").addEventListener("click", zoom(1 / 1.45));

attachCamera(view, {
  panned: () => setCamera("free"),
  zoomed: () => {
    if (camera === "director") setCamera("free");
    return camera === "follow";
  },
});

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
    if (el.closest("button, textarea") && key === " ") return;
    if (matchView.key(e)) e.preventDefault();
    return;
  }
  if (tab !== "live") return;
  const pan = 90;
  const moves: Record<string, () => void> = {
    a: () => setCamera("follow"),
    l: () => setCamera("follow"),
    d: () => setCamera("director"),
    t: () => setTactical(!view.tactical),
    c: jump(() => frameBase()),
    f: jump(() => frameMap()),
    s: jump(frameSpawn),
    "+": zoom(1.3),
    "=": zoom(1.3),
    "-": zoom(1 / 1.3),
    arrowleft: jump(() => view.panBy(pan, 0)),
    arrowright: jump(() => view.panBy(-pan, 0)),
    arrowup: jump(() => view.panBy(0, pan)),
    arrowdown: jump(() => view.panBy(0, -pan)),
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
  setCamera("free");
  view.lookAt(x, y, Math.max(view.goal.z, 30));
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

// In `vite dev`, ?state=idle or ?state=paused forces that match state, to work on those screens.
const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get("state") : null;

// In `vite dev`, ?plan=demo pins a sample plan, to work on the plan board before a model sets one.
const demoPlan: PlanGoal[] | null =
  import.meta.env.DEV && new URLSearchParams(location.search).get("plan") === "demo"
    ? [
        { text: "double copper income off the north seam", status: "done", x: 96, y: 86 },
        { text: "feed both duos from one router", status: "done" },
        { text: "wall the southwest approach before wave 18", status: "active", x: 90, y: 92 },
        { text: "get graphite going for the hail battery", status: "active", x: 104, y: 79 },
        { text: "scatter by the core for the flares", status: "blocked", x: 99, y: 101 },
        { text: "power grid: two combustion generators", status: "active" },
        { text: "titanium conveyor on the main trunk", status: "active", x: 101, y: 95 },
        { text: "second core feed from the east drills", status: "active" },
      ]
    : null;

function onMeta(m: Meta | null): void {
  if (!m) return;
  if (forced === "idle" || forced === "paused") {
    m = { ...m, matchState: forced, matchId: forced === "idle" ? null : m.matchId, aiPaused: true };
  }
  if (demoPlan) m = { ...m, plan: demoPlan };
  const was = meta?.matchState;
  meta = m;
  renderPlan(m.plan, jumpTo);
  view.frozen = m.matchState === "paused";
  if (m.matchState !== was) {
    syncAir();
    if (m.matchState === "idle") void refreshLeaderboard();
    else if (was === "idle") {
      // Back on air: the stage was hidden, so size it and frame the new match.
      framed = false;
      view.resize();
    }
  }
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
    case "interview":
      matchView.onInterview(msg.matchId, msg.item);
      break;
    case "interview_deleted":
      matchView.onInterviewDeleted(msg.matchId, msg.id);
      break;
    case "plan":
      // The model can rewrite its plan in the middle of a turn, so this arrives on its own.
      if (meta && !demoPlan) {
        meta = { ...meta, plan: msg.plan };
        renderPlan(msg.plan, jumpTo);
      }
      break;
    case "leaderboard":
      leaderboard = msg.leaderboard;
      if (tab === "leaderboard") drawBoard();
      if (offAir() && tab === "live") drawOffAir();
      break;
    case "factorio":
      factorio = msg.factorio;
      break;
    case "config":
      onMeta(msg.meta);
      if (msg.leaderboard) leaderboard = msg.leaderboard;
      deck?.onConfig(msg.config);
      if (tab === "leaderboard") drawBoard();
      if (offAir() && tab === "live") drawOffAir();
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
let shipLabel = "";
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
    if (tab === "live" && !offAir()) {
      let t = performance.now();
      world.terrain?.stepLow(4);
      world.tick(now);
      if (camera === "director") director.update(now);
      else if (camera === "follow") shipLabel = followShip();
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

  if (tab === "live" && offAir()) drawOffAir();
  else if (tab === "live") {
    renderBrainStatus(world.state, meta, now);
    // One line under the map says what the camera is on. A free camera has nothing to say.
    const label = camera === "director" ? director.label : camera === "follow" ? shipLabel : "";
    const key = `${camera}|${label}`;
    if (key !== captionNow) {
      captionNow = key;
      caption.hidden = !label;
      caption.dataset.mode = camera === "follow" ? "following" : camera;
      if (morph) morph.update(label);
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

{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("arena.camera");
  } catch {
    // private mode
  }
  if (saved === "director") setCamera("director");
  else view.ease = 0.1;
}
setTactical(store.get("tactical", false));
route();
onAtlas(() => renderStock(world.state));
void loadAtlas();
connect();
void probeAdmin();
requestAnimationFrame(loop);
