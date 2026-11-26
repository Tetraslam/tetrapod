import { iconFor, iconURL } from "./atlas";
import { isModelId, tickerEl } from "./lines";
import type { Pick } from "./renderer";
import { ORE_COLORS } from "./terrain";
import type { Factorio, FeedAction, FeedItem, Leaderboard, MatchRow, Meta, State } from "./types";
import { $, ago, clamp, clock, duration, h, mmss, num, setText } from "./util";
import { HOME, type World } from "./world";

/** Set a board value and flip it over if it changed. */
function flap(el: HTMLElement, text: string): void {
  if (el.textContent === text) return;
  const first = el.dataset.set !== "1";
  el.dataset.set = "1";
  el.textContent = text;
  if (first) return;
  el.classList.remove("flap");
  void el.offsetWidth;
  el.classList.add("flap");
}

const meter = (el: HTMLElement, frac: number) => {
  el.style.transform = `scaleX(${clamp(frac, 0, 1)})`;
};

/** Swap the ticker in a slot only when the model actually changed. */
function setTicker(slot: HTMLElement, id: string, size: "s" | "m" | "l"): void {
  if (slot.dataset.id === id) return;
  slot.dataset.id = id;
  slot.replaceChildren(tickerEl(id, size));
}

// ---------- the board ----------

let longestWait = 1;
let waveSeen = -1;

export function renderBoard(state: State | null, meta: Meta | null): void {
  if (meta) {
    setTicker($("bTicker"), meta.contender.id, "l");
    setTicker($("brainTicker"), meta.contender.id, "m");
    flap($("tBuilt"), num(meta.blocksBuilt));
    const total = meta.actionsOk + meta.actionsFail;
    flap($("tActions"), `${meta.actionsOk} / ${total}`);
    flap($("tAcc"), total ? `${Math.round((meta.actionsOk / total) * 100)}%` : "--");
    const n = meta.spectators;
    setText($("watching"), `${n} watching`);
  }
  if (!state) return;
  const over = state.gameOver || !state.core;
  flap($("bWave"), String(state.wave).padStart(2, "0"));

  if (state.wave !== waveSeen) {
    waveSeen = state.wave;
    longestWait = Math.max(1, state.waveTime);
  }
  longestWait = Math.max(longestWait, state.waveTime);
  const next = $("bNext");
  setText(next, over ? "-:--" : mmss(state.waveTime));
  const soon = !over && state.waveTime < 10;
  next.toggleAttribute("data-alarm", soon);
  next.parentElement!.toggleAttribute("data-alarm", soon);
  meter($("bNextFill"), over ? 0 : 1 - state.waveTime / longestWait);

  const hostiles = $("bHostiles");
  flap(hostiles, String(state.enemies));
  hostiles.toggleAttribute("data-alarm", state.enemies > 0);

  const core = $("bCore");
  const cell = core.parentElement!;
  if (state.core && !state.gameOver) {
    const frac = state.core.hp / Math.max(1, state.core.maxHp);
    // No flip here: in a fight this changes several times a second and has to stay readable.
    setText(core, `${Math.round(frac * 100)}%`);
    setText($("bCoreHp"), `${num(state.core.hp)} hp`);
    meter($("bCoreFill"), frac);
    cell.toggleAttribute("data-alarm", frac < 0.35);
  } else {
    setText(core, "lost");
    setText($("bCoreHp"), "");
    meter($("bCoreFill"), 0);
    cell.setAttribute("data-alarm", "");
  }
  setText($("bMap"), state.map);
  setText($("bMatch"), meta?.matchId ? `match ${meta.matchId} on` : "map");
  setText($("bLineLabel"), over ? "just played" : "now playing");
}

let thinkingSince = 0;

export function renderBrainStatus(state: State | null, meta: Meta | null, now: number): void {
  const el = $("brainStatus");
  const brain = el.closest<HTMLElement>(".brain")!;
  let mode = "idle";
  let text = "between moves";
  if (!meta) text = "waiting";
  else if (state?.gameOver) {
    mode = "over";
    text = "core lost, next model is up";
  } else if (meta.aiPaused) {
    mode = "paused";
    text = "paused";
  } else if (meta.aiBusy) {
    if (!thinkingSince) thinkingSince = now;
    mode = "thinking";
    text = `thinking ${Math.floor((now - thinkingSince) / 1000)}s`;
  }
  if (mode !== "thinking") thinkingSince = 0;
  el.dataset.state = mode;
  setText(el, text);
  brain.toggleAttribute("data-thinking", mode === "thinking");
}

// ---------- core stock ----------

const STOCK_ORDER = [
  "copper",
  "lead",
  "graphite",
  "silicon",
  "coal",
  "sand",
  "scrap",
  "titanium",
  "metaglass",
  "thorium",
];
let stockKey = "";

export function renderStock(state: State | null): void {
  const list = $("stock");
  if (!state?.core) {
    if (stockKey) list.replaceChildren();
    stockKey = "";
    return;
  }
  const rank = (name: string) => {
    const i = STOCK_ORDER.indexOf(name);
    return i < 0 ? 99 : i;
  };
  // Copper and lead always show, even at zero: they are what everything is built from.
  const names = [...new Set(["copper", "lead", ...Object.keys(state.items)])].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b),
  );
  const power = state.power.produced > 0 || state.power.consumed > 0;
  const key = `${names.join(",")}|${power}|${iconURL("item-copper") ? 1 : 0}`;
  if (key !== stockKey) {
    stockKey = key;
    list.replaceChildren(
      ...names.map((name) => {
        const url = iconURL(`item-${name}`);
        return h(
          "li",
          { title: name, "data-item": name },
          url
            ? h("img", { src: url, alt: name, width: 18, height: 18 })
            : h("i", { class: "pw", style: { background: ORE_COLORS[name] || "#b3ac9c" } }),
          h("span", null, "0"),
        );
      }),
      ...(power
        ? [
            h(
              "li",
              { title: "power, made minus used", "data-item": "power" },
              h("i", { class: "pw" }),
              h("span", null, "0"),
            ),
          ]
        : []),
    );
  }
  for (const li of list.children as HTMLCollectionOf<HTMLElement>) {
    const span = li.lastElementChild as HTMLElement;
    if (li.dataset.item === "power") {
      const net = state.power.produced - state.power.consumed;
      setText(span, `${net >= 0 ? "+" : ""}${num(net)}`);
      span.classList.toggle("neg", net < 0);
    } else setText(span, num(state.items[li.dataset.item!] || 0));
  }
}

export function renderLegend(world: World, on: boolean): void {
  const el = $("legend");
  el.hidden = !on;
  if (!on) return;
  const ores = world.terrain?.oreNames || [];
  const key = ores.join(",");
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(
    ...ores.map((o) =>
      h("li", null, h("i", { style: { background: ORE_COLORS[o] || "#efe9dc" } }), `${o} ore`),
    ),
    h("li", null, h("i", { class: "ring" }), "turret reach"),
    h("li", null, h("i", { class: "ring dry" }), "no ammo"),
    h("li", null, h("i", { class: "route" }), "ground route in"),
  );
}

// ---------- inspector ----------

let inspectKey = "";

export function renderInspector(world: World, pick: Pick | null): void {
  const el = $("inspect");
  const row = (label: string, value: string, bad = false) =>
    h("p", bad ? { class: "bad" } : null, h("span", null, label), value);
  let key = "";
  let build: (() => Node[]) | null = null;

  if (pick?.kind === "unit") {
    const v = world.units.get(pick.id);
    if (v) {
      const u = v.u;
      key = `u${u.id}|${Math.round(u.hp)}|${Math.round(v.x)},${Math.round(v.y)}`;
      build = () => [
        icon(u.type),
        h("h3", null, u.type),
        h("p", null, `${u.team} unit at ${Math.round(v.x)}, ${Math.round(v.y)}`),
        hpBar(u.hp, u.maxHp, u.team !== HOME),
        h(
          "div",
          { class: "rows" },
          row("health", `${num(u.hp)} / ${num(u.maxHp)}`),
          row("moves by", v.flying ? "air" : "ground"),
        ),
      ];
    }
  } else if (pick?.kind === "building") {
    const v = world.buildings.get(pick.key);
    if (v) {
      const b = v.b;
      key = `b${v.key}|${b.block}|${Math.round(b.hp)}|${b.ammo}`;
      build = () => {
        const rows: Node[] = [row("health", `${num(b.hp)} / ${num(b.maxHp)}`)];
        if (v.kind === "turret") {
          rows.push(b.ammo > 0 ? row("ammo", String(b.ammo)) : row("ammo", "none, it cannot fire", true));
          rows.push(row("reach", `${v.range.toFixed(1)} tiles`));
        }
        if (v.kind === "drill") {
          const ore = oreUnder(world, v.ox, v.oy, b.size);
          rows.push(ore ? row("mining", ore) : row("mining", "nothing, no ore under it", true));
        }
        if (v.kind === "conveyor") rows.push(row("runs", ["east", "north", "west", "south"][b.rot % 4]));
        return [
          icon(b.block),
          h("h3", null, b.block),
          h("p", null, `${b.team} at ${b.x}, ${b.y}${b.size > 1 ? `, ${b.size}x${b.size}` : ""}`),
          hpBar(b.hp, b.maxHp, b.team !== HOME),
          h("div", { class: "rows" }, ...rows),
        ];
      };
    }
  } else if (pick?.kind === "tile" && world.terrain) {
    const t = world.terrain;
    const ore = t.oreAt(pick.x, pick.y);
    const wall = t.isWall(pick.x, pick.y);
    const name = t.tileName(pick.x, pick.y) || "ground";
    key = `t${pick.x},${pick.y}`;
    build = () => [
      icon(ore ? `ore-${ore}1` : `${name}1`),
      h("h3", null, ore ? `${ore} ore` : name),
      h("p", null, `tile ${pick.x}, ${pick.y}`),
      h(
        "div",
        { class: "rows" },
        row(wall ? "solid rock" : "open ground", wall ? "can't build" : ore ? `on ${name}` : "buildable"),
      ),
    ];
  }

  el.toggleAttribute("data-empty", !build);
  if (!build || key === inspectKey) return;
  inspectKey = key;
  el.replaceChildren(...build());
}

function icon(name: string): HTMLElement {
  const url = iconFor(name) || iconURL(name);
  return url ? h("img", { src: url, alt: "" }) : h("span", { class: "noicon" });
}

function hpBar(hp: number, max: number, foe: boolean): HTMLElement {
  const frac = clamp(hp / Math.max(1, max), 0, 1);
  return h(
    "div",
    { class: "hp", "data-low": frac < 0.35 ? "" : null, "data-foe": foe ? "" : null },
    h("i", { style: { width: `${frac * 100}%` } }),
  );
}

function oreUnder(world: World, ox: number, oy: number, size: number): string | null {
  const counts = new Map<string, number>();
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      const ore = world.terrain?.oreAt(ox + dx, oy + dy);
      if (ore) counts.set(ore, (counts.get(ore) || 0) + 1);
    }
  let best: string | null = null;
  let n = 0;
  for (const [ore, c] of counts)
    if (c > n) {
      n = c;
      best = ore;
    }
  return best ? `${best}, ${n} of ${size * size} tiles` : null;
}

// ---------- announcements ----------

let announceTimer = 0;

export function announce(
  title: string,
  detail: string,
  tone: "signal" | "hostile" | "plain" = "signal",
): void {
  const el = $("announce");
  el.replaceChildren(h("span", null, title), h("small", null, detail));
  el.dataset.tone = tone;
  el.removeAttribute("data-show");
  void el.offsetWidth;
  el.setAttribute("data-show", "");
  clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => el.removeAttribute("data-show"), 3700);
}

// ---------- feed ----------

export type Target = { x: number; y: number; ok: boolean };

/** Tile coordinates named in an action label like "duo @(128,42)" or "conveyor (1,2)→(5,2)". */
export function actionTargets(a: FeedAction): Target[] {
  const out: Target[] = [];
  for (const m of a.label.matchAll(/\((-?\d+),\s*(-?\d+)\)/g))
    out.push({ x: Number(m[1]), y: Number(m[2]), ok: a.ok });
  return out;
}

const shortError = (err: string) =>
  err
    .replace(/ at \(-?\d+,-?\d+\)( for [\w-]+)?/, "")
    .replace(/ \(need /, ": need ")
    .replace(/\)$/, "");

const seenFeed = new Set<number>();

function entry(item: FeedItem, onJump: (targets: Target[]) => void): HTMLElement {
  const time = h("time", { datetime: new Date(item.ts).toISOString() }, clock(item.ts));
  const body = h("div", null);
  if (item.kind === "thought") {
    body.append(
      h(
        "div",
        { class: "head" },
        isModelId(item.model)
          ? tickerEl(item.model, "s")
          : h("span", { class: "quiet" }, item.model || "arena"),
        time,
      ),
      h("p", null, item.text),
    );
    if (item.actions?.length) {
      body.append(
        h(
          "ul",
          { class: "acts" },
          ...item.actions.map((a) => {
            const targets = actionTargets(a);
            return h(
              "li",
              { class: a.ok ? "ok" : "fail" },
              h(
                "button",
                {
                  disabled: targets.length ? null : "",
                  title: targets.length ? "show this on the map" : null,
                  onclick: () => onJump(targets),
                },
                h("i", null),
                h("code", null, a.label),
                !a.ok && a.error ? h("em", { title: a.error }, shortError(a.error)) : null,
              ),
            );
          }),
        ),
      );
    }
  } else {
    body.append(h("p", null, item.text), time);
  }
  const kind = item.kind === "thought" ? "thought" : `note ${item.kind}`;
  return h("li", { class: `entry ${kind}`, "data-id": item.id }, body);
}

export function setFeed(items: FeedItem[], onJump: (targets: Target[]) => void): void {
  seenFeed.clear();
  const list = $("feed");
  const nodes: HTMLElement[] = [];
  for (const item of [...items].sort((a, b) => b.id - a.id)) {
    if (seenFeed.has(item.id)) continue;
    seenFeed.add(item.id);
    nodes.push(entry(item, onJump));
  }
  list.replaceChildren(...nodes);
}

export function addFeed(item: FeedItem, onJump: (targets: Target[]) => void): boolean {
  if (seenFeed.has(item.id)) return false;
  seenFeed.add(item.id);
  const list = $("feed");
  const el = entry(item, onJump);
  // Someone reading older entries keeps their place. At the top, the new one unfolds in.
  const reading = list.scrollTop > 12;
  if (!reading) el.classList.add("enter");
  list.prepend(el);
  if (reading) list.scrollTop += el.getBoundingClientRect().height;
  while (list.children.length > 60) list.lastElementChild!.remove();
  return true;
}

// ---------- leaderboard ----------

const accuracy = (ok: number, fail: number): HTMLElement => {
  const total = ok + fail;
  if (!total) return h("span", { class: "quiet" }, "--");
  const frac = ok / total;
  return h(
    "span",
    { class: "acc" },
    h("i", null, h("i", { style: { width: `${frac * 100}%` } })),
    `${Math.round(frac * 100)}%`,
  );
};

const th = (label: string, left = false) => h("th", left ? { class: "l" } : null, label);

export function renderLeaderboard(lb: Leaderboard | null, meta: Meta | null): void {
  if (!lb) return;
  const live = meta?.contender.id;
  const standings = $("standings");
  standings.replaceChildren(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        th("", true),
        th("model", true),
        th("best wave"),
        th("avg wave"),
        th("matches"),
        th("blocks built"),
        th("actions landed"),
      ),
    ),
    h(
      "tbody",
      null,
      ...(lb.models.length
        ? lb.models.map((r, i) =>
            h(
              "tr",
              null,
              h("td", { class: "pos" }, String(i + 1)),
              h(
                "td",
                { class: "l" },
                tickerEl(r.model, "m"),
                r.model === live ? h("span", { class: "now" }, "on now") : null,
              ),
              h("td", { class: "best" }, String(r.best_wave)),
              h("td", null, Number(r.avg_wave).toFixed(1)),
              h("td", null, String(r.matches)),
              h("td", null, num(r.total_blocks)),
              h("td", null, accuracy(r.actions_ok, r.actions_fail)),
            ),
          )
        : [
            h(
              "tr",
              { class: "empty" },
              h(
                "td",
                { colspan: 7 },
                "no matches on the board yet. the first one is being played right now.",
              ),
            ),
          ]),
    ),
  );

  const status = (m: MatchRow): HTMLElement => {
    if (m.id === meta?.matchId) return h("span", { class: "now" }, "on now");
    if (!m.ended_at)
      return h(
        "span",
        { class: "quiet", title: "the arena restarted before this one finished" },
        "cut short",
      );
    return h("span", { title: new Date(m.ended_at).toLocaleString() }, ago(m.ended_at));
  };
  $("matches").replaceChildren(
    h(
      "thead",
      null,
      h(
        "tr",
        null,
        th("#", true),
        th("model", true),
        th("map", true),
        th("wave"),
        th("blocks"),
        th("actions landed"),
        th("lasted"),
        th("ended"),
      ),
    ),
    h(
      "tbody",
      null,
      ...(lb.recentMatches.length
        ? lb.recentMatches.map((m) =>
            h(
              "tr",
              null,
              h("td", { class: "l quiet" }, String(m.id)),
              h("td", { class: "l" }, tickerEl(m.model, "s")),
              h("td", { class: "l" }, m.map),
              h("td", null, String(m.peak_wave)),
              h("td", null, num(m.blocks_built)),
              h("td", null, accuracy(m.actions_ok, m.actions_fail)),
              h(
                "td",
                null,
                m.ended_at
                  ? duration((m.ended_at - m.started_at) / 1000)
                  : m.id === meta?.matchId
                    ? duration((Date.now() - m.started_at) / 1000)
                    : "--",
              ),
              h("td", null, status(m)),
            ),
          )
        : [h("tr", { class: "empty" }, h("td", { colspan: 8 }, "no matches yet."))]),
    ),
  );

  $("roster").replaceChildren(
    ...lb.roster.map((c) =>
      h(
        "li",
        { "data-now": c.id === live ? "" : null },
        tickerEl(c.id, "m"),
        c.id === live ? h("span", { class: "now" }, "on now") : null,
      ),
    ),
  );
  $("maps").replaceChildren(...lb.maps.map((m) => h("li", null, m)));
}

// ---------- factorio ----------

export function renderFactorio(f: Factorio | null, now: number): void {
  const status = $("fStatus");
  const cell = status.parentElement!;
  if (!f?.updatedAt) {
    setText(status, "--");
    setText($("fChecked"), "no word from the server yet");
    cell.dataset.state = "wait";
    return;
  }
  flap(status, f.online ? "online" : "offline");
  cell.dataset.state = f.online ? "on" : "off";
  setText($("fChecked"), `checked ${ago(f.updatedAt, now)}`);

  // The server can answer rcon while the telemetry script returns nothing. Say so and blank the numbers.
  const blind = f.online && f.tick === 0;
  const note = $("fNote");
  note.hidden = !(blind || (!f.online && f.error));
  if (!note.hidden) {
    note.replaceChildren(
      blind
        ? "rcon answers, but the telemetry script came back empty, so the numbers below are blank. it said: "
        : "rcon said: ",
      h("code", null, (f.error || "nothing").slice(0, 160)),
    );
  }
  const dim = blind || !f.online;
  $("fGrid").toggleAttribute("data-dim", dim);
  const show = (id: string, text: string) => setText($(id), dim ? "--" : text);
  show("fAge", duration(f.playtimeSec));
  setText($("fTick"), dim ? "" : `tick ${num(f.tick)}`);
  setText($("fPlayers"), f.online ? String(f.playersOnline) : "--");
  setText($("fIdle"), f.online && f.playersOnline === 0 ? "the factory pauses while it's empty" : "");
  setText($("fBuild"), `${f.version ? `factorio ${f.version}, ` : ""}arm64, running under box64`);
  show("fEvo", `${(f.evolution * 100).toFixed(1)}%`);
  meter($("fEvoFill"), dim ? 0 : f.evolution);
  show("fEnts", num(f.entitiesNearSpawn));
  setText($("fSurface"), f.surface || "nauvis");
  // Factorio's day runs 0..1 starting at noon. 0.25 is dusk, 0.5 midnight, 0.75 dawn.
  const d = f.daytime;
  show("fDay", d < 0.2 || d > 0.8 ? "day" : d < 0.3 ? "dusk" : d < 0.7 ? "night" : "dawn");
  meter($("fDayFill"), dim ? 0 : d);
}
