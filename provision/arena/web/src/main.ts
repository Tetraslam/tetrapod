import "@fontsource-variable/inter/wght.css";
import "@fontsource/commit-mono/latin-400.css";
import "@fontsource/commit-mono/latin-700.css";
import "@fontsource/barlow-condensed/latin-500.css";
import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-700.css";
import "./style.css";

import { loadAtlas, onAtlas } from "./atlas";
import { Director } from "./director";
import {
  actionTargets,
  addFeed,
  announce,
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
import { Minimap } from "./minimap";
import { type Pick, Renderer } from "./renderer";
import { TerrainModel } from "./terrain";
import type { Factorio, FeedItem, Leaderboard, Meta, ServerMessage, State, Terrain } from "./types";
import { $, clock, setText } from "./util";
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
let framed = false;

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

// ---------- tabs ----------

type Tab = "live" | "leaderboard" | "factorio";
const TABS: Tab[] = ["live", "leaderboard", "factorio"];
let tab: Tab = "live";

function showTab(next: Tab, push = true): void {
  tab = next;
  for (const t of TABS) {
    $(`view-${t}`).hidden = t !== next;
    $(`tab-${t}`).setAttribute("aria-selected", String(t === next));
  }
  if (push && location.hash !== `#${next}`) history.replaceState(null, "", `#${next}`);
  if (next === "leaderboard") {
    renderLeaderboard(leaderboard, meta);
    void refreshLeaderboard();
  }
  if (next === "factorio") renderFactorio(factorio, Date.now());
  if (next === "live") view.resize();
}

for (const t of TABS) $(`tab-${t}`).addEventListener("click", () => showTab(t));
window.addEventListener("hashchange", () => {
  const want = location.hash.slice(1) as Tab;
  if (TABS.includes(want) && want !== tab) showTab(want, false);
});
$("tab-leaderboard").addEventListener("pointerenter", () => void refreshLeaderboard(), { passive: true });

async function refreshLeaderboard(): Promise<void> {
  try {
    leaderboard = (await (await fetch("/api/leaderboard")).json()) as Leaderboard;
    if (tab === "leaderboard") renderLeaderboard(leaderboard, meta);
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

const canvas = view.canvas;
const pointers = new Map<number, { x: number; y: number }>();
let dragged = 0;
let pinch = 0;

const local = (e: { clientX: number; clientY: number }) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};

canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  dragged = 0;
  pinch = 0;
});

canvas.addEventListener("pointermove", (e) => {
  const p = local(e);
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    view.hover = view.pick(p.x, p.y);
    return;
  }
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    dragged += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
    if (dragged > 4) {
      canvas.classList.add("dragging");
      director.touch(performance.now());
      view.panBy(p.x - prev.x, p.y - prev.y);
      view.hover = null;
    }
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    director.touch(performance.now());
    if (pinch > 0) view.zoomAt(mid.x, mid.y, dist / pinch);
    view.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
    pinch = dist;
    dragged = 99;
  }
});

const release = (e: PointerEvent) => {
  if (!pointers.delete(e.pointerId)) return;
  canvas.classList.remove("dragging");
  if (dragged <= 4 && e.type === "pointerup") {
    const p = local(e);
    const hit = view.pick(p.x, p.y);
    view.selected = hit && hit.kind !== "tile" ? hit : samePick(hit, view.selected) ? null : hit;
  }
  pinch = 0;
};
canvas.addEventListener("pointerup", release);
canvas.addEventListener("pointercancel", release);
canvas.addEventListener("pointerleave", () => {
  if (!pointers.size) view.hover = null;
});

function samePick(a: Pick | null, b: Pick | null): boolean {
  return !!a && !!b && a.kind === "tile" && b.kind === "tile" && a.x === b.x && a.y === b.y;
}

canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    director.touch(performance.now());
    const p = local(e);
    const step = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    view.zoomAt(p.x, p.y, Math.exp(-step * (e.ctrlKey ? 0.01 : 0.0016)));
  },
  { passive: false },
);

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const key = e.key.toLowerCase();
  if (key >= "1" && key <= "3") return showTab(TABS[Number(key) - 1]);
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

function onFeed(item: FeedItem): void {
  if (!addFeed(item, jumpTo)) return;
  const now = performance.now();
  for (const a of item.actions || []) for (const t of actionTargets(a)) world.ping(t.x, t.y, t.ok, now);
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
};

// ---------- data in ----------

function onTerrain(t: Terrain | null): void {
  if (!t?.ready) return;
  if (world.terrain?.map === t.map && world.terrain.w === t.width) return;
  world.setTerrain(new TerrainModel(t));
  framed = false;
  renderLegend(world, view.tactical);
}

function onState(state: State | null, m: Meta | null): void {
  if (m) meta = m;
  if (!state?.ready) return;
  lastStateAt = performance.now();
  world.apply(state, lastStateAt);
  if (!framed && world.terrain && world.terrain.map === state.map) {
    framed = true;
    view.resize();
    frameBase(true);
    $("waiting").setAttribute("data-gone", "");
  }
  renderBoard(state, meta);
  renderStock(state);
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case "init":
      onTerrain(msg.terrain);
      if (msg.feed) setFeed(msg.feed, jumpTo);
      if (msg.leaderboard) leaderboard = msg.leaderboard;
      if (msg.factorio) factorio = msg.factorio;
      onState(msg.state, msg.meta);
      renderBoard(world.state, meta);
      if (tab === "leaderboard") renderLeaderboard(leaderboard, meta);
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
      if (tab === "leaderboard") renderLeaderboard(leaderboard, meta);
      break;
    case "factorio":
      factorio = msg.factorio;
      break;
  }
}

let retry = 0;
function connect(): void {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`);
  ws.onopen = () => {
    socketUp = true;
    retry = 0;
  };
  ws.onmessage = (ev) => {
    try {
      handle(JSON.parse(ev.data) as ServerMessage);
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

let slowAt = 0;

function loop(now: number): void {
  if (tab === "live" && !document.hidden) {
    world.terrain?.stepLow(4);
    world.tick(now);
    director.update(now);
    view.frame(now);
    minimap.draw(now);
    renderInspector(world, view.hover || view.selected);
  }
  if (now - slowAt > 250) {
    slowAt = now;
    setText($("clock"), clock(Date.now()));
    const lamp = $("link");
    const age = lastStateAt ? (now - lastStateAt) / 1000 : 0;
    const state = !socketUp ? "down" : !lastStateAt ? "wait" : age > 3 ? "stale" : "live";
    lamp.dataset.state = state;
    setText(
      lamp,
      state === "live"
        ? "live"
        : state === "stale"
          ? `no data for ${Math.round(age)}s`
          : state === "down"
            ? "reconnecting"
            : "connecting",
    );
    renderBrainStatus(world.state, meta, now);
    const label = $("directorLabel");
    if (director.label)
      label.replaceChildren(
        Object.assign(document.createElement("b"), { textContent: "director " }),
        director.label,
      );
    else label.replaceChildren();
    if (tab === "factorio") renderFactorio(factorio, Date.now());
    if (tab === "live" && world.state) renderBoard(world.state, meta);
  }
  requestAnimationFrame(loop);
}

// A handle for poking at the live match from the console.
Object.assign(window, { arena: { world, view, director } });

setDirector(store.get("director", true));
setTactical(store.get("tactical", false));
const startTab = location.hash.slice(1) as Tab;
showTab(TABS.includes(startTab) ? startTab : "live", false);
onAtlas(() => {
  renderStock(world.state);
});
void loadAtlas();
connect();
requestAnimationFrame(loop);
