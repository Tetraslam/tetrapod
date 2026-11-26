import pauseIcon from "@phosphor-icons/core/fill/pause-fill.svg?raw";
import playIcon from "@phosphor-icons/core/fill/play-fill.svg?raw";
import backIcon from "@phosphor-icons/core/fill/skip-back-fill.svg?raw";
import forwardIcon from "@phosphor-icons/core/fill/skip-forward-fill.svg?raw";
import { iconFor, iconURL } from "./atlas";
import { actionList, actionTargets, ending, planList, renderInspector, seconds, type Target } from "./hud";
import { attachCamera } from "./input";
import { lineColor, tickerEl } from "./lines";
import { Renderer } from "./renderer";
import { TerrainModel } from "./terrain";
import type { MatchDetail, Snapshot, State, Terrain, TimelinePoint } from "./types";
import { $, clamp, clock, duration, h, num, setText } from "./util";
import { World } from "./world";

const SVG = "http://www.w3.org/2000/svg";
const STEP_MS = 1500;
const SPEEDS = [1, 2, 4];

type Series = {
  label: string;
  color: string;
  value: (p: TimelinePoint) => number;
  area?: boolean;
  step?: boolean;
};
type Strip = { name: string; series: Series[]; bars?: Series; unit?: (v: number) => string };

const STRIPS: Strip[] = [
  {
    name: "economy",
    series: [
      { label: "copper", color: "#d99d73", value: (p) => p.copper },
      { label: "lead", color: "#a79bc4", value: (p) => p.lead },
      { label: "graphite", color: "#b2c6d2", value: (p) => p.graphite },
    ],
  },
  {
    name: "base",
    series: [
      { label: "blocks", color: "#b3ac9c", value: (p) => p.buildings },
      { label: "turrets", color: "#ffd37f", value: (p) => p.turrets, step: true },
      { label: "armed", color: "#ffd37f", value: (p) => p.armedTurrets, step: true, area: true },
    ],
  },
  {
    name: "core and hostiles",
    series: [
      {
        label: "core",
        color: "#efe9dc",
        value: (p) => (p.coreMaxHp ? Math.round((p.coreHp / p.coreMaxHp) * 100) : 0),
        area: true,
      },
    ],
    bars: { label: "hostiles", color: "#f25555", value: (p) => p.enemies },
  },
  {
    name: "thinking time",
    series: [],
    bars: { label: "took", color: "#7d776a", value: (p) => p.latencyMs / 1000 },
    unit: (v) => (v > 0 ? `${v.toFixed(1)}s` : "--"),
  },
];

/** `vite dev` only (?plan=demo): give a recorded match a plan that grows and resolves, to work on the replay's plan view. */
function demoPlans(detail: MatchDetail): void {
  const core = detail.snapshots[0]?.buildings.find((b) => b.block.startsWith("core-"));
  const cx = core?.x ?? 100;
  const cy = core?.y ?? 100;
  const goals = [
    { text: "copper drills straight into the core", x: cx + 4, y: cy - 3 },
    { text: "two duos on the spawn side, fed by one router", x: cx - 5, y: cy + 2 },
    { text: "wall the approach before the next wave", x: cx - 8, y: cy + 4 },
    { text: "lead income for a scatter" },
    { text: "graphite for a hail battery", x: cx + 7, y: cy + 6 },
  ];
  const n = detail.snapshots.length;
  detail.snapshots.forEach((s, i) => {
    const t = i / Math.max(1, n - 1);
    s.plan = goals.slice(0, Math.min(goals.length, 1 + Math.floor(t * 6))).map((g, k) => ({
      ...g,
      status: t > (k + 1.5) / 6 ? "done" : k === 3 && t > 0.6 && t < 0.85 ? "blocked" : "active",
    }));
  });
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function icon(raw: string): HTMLElement {
  const el = h("span", { class: "ico", "aria-hidden": "true" });
  el.innerHTML = raw;
  return el;
}

/**
 * The breakdown of one match: its replay on the real map, a scrubber, charts on the same
 * axis as the scrubber, and every turn's reasoning. Works for a finished match and for the live one.
 */
export class MatchView {
  private world = new World();
  private view: Renderer;
  private detail: MatchDetail | null = null;
  private id = 0;
  private at = 0;
  private playing = false;
  private speed = 1;
  private nextAt = 0;
  private touchedAt = -1e9;
  private terrains = new Map<string, TerrainModel>();
  private loading = 0;
  private inspectAt = 0;
  private follow = false;

  constructor(
    /** The live match's terrain, so its replay doesn't download and bake the map twice. */
    private liveTerrain: () => TerrainModel | null,
    private liveMatchId: () => number | null,
  ) {
    this.view = new Renderer($<HTMLCanvasElement>("mMap"), this.world);
    const mine = () => {
      this.touchedAt = performance.now();
      this.view.ease = 0.08;
    };
    attachCamera(this.view, {
      panned: mine,
      zoomed: () => {
        mine();
        return false;
      },
    });
    $("mPlay").addEventListener("click", () => this.toggle());
    $("mBack").addEventListener("click", () => this.step(-1));
    $("mFwd").addEventListener("click", () => this.step(1));
    $("mBack").append(icon(backIcon));
    $("mFwd").append(icon(forwardIcon));
    for (const s of SPEEDS) {
      $("mSpeeds").append(
        h(
          "button",
          { class: "key", "data-speed": s, "aria-pressed": String(s === 1), onclick: () => this.setSpeed(s) },
          `${s}x`,
        ),
      );
    }
    this.syncPlay();

    // One pointer handler for the whole timeline: track and charts share an x axis, so a press anywhere seeks.
    const lane = $("mLane");
    let down = false;
    const seek = (e: PointerEvent) => {
      const n = this.detail?.snapshots.length || 0;
      if (!n) return;
      const r = lane.getBoundingClientRect();
      this.pause();
      this.select(Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * (n - 1)));
    };
    lane.addEventListener("pointerdown", (e) => {
      down = true;
      lane.setPointerCapture(e.pointerId);
      seek(e);
    });
    lane.addEventListener("pointermove", (e) => {
      if (down) seek(e);
    });
    const up = () => {
      down = false;
    };
    lane.addEventListener("pointerup", up);
    lane.addEventListener("pointercancel", up);
  }

  get open(): boolean {
    return this.id > 0;
  }

  key(e: KeyboardEvent): boolean {
    const k = e.key.toLowerCase();
    if (k === " ") this.toggle();
    else if (k === "arrowleft") this.step(-1);
    else if (k === "arrowright") this.step(1);
    else if (k === "home") this.select(0);
    else if (k === "end") this.select((this.detail?.snapshots.length || 1) - 1);
    else return false;
    return true;
  }

  async show(id: number, seq?: number): Promise<void> {
    const same = id === this.id && this.detail;
    this.id = id;
    if (same) {
      if (seq) this.selectSeq(seq);
      return;
    }
    this.pause();
    this.detail = null;
    this.world.state = null;
    this.world.terrain = null;
    this.renderHead();
    $("mBody").dataset.state = "loading";
    await this.load(seq);
  }

  hide(): void {
    this.pause();
    this.id = 0;
  }

  /** The live match took a turn: pull the new snapshots, and stay on the newest if that is where we were. */
  refresh(): void {
    if (!this.open || this.id !== this.liveMatchId() || this.loading) return;
    const n = this.detail?.snapshots.length || 0;
    this.follow = this.at >= n - 1;
    void this.load();
  }

  private async load(seq?: number): Promise<void> {
    const id = this.id;
    const token = ++this.loading;
    try {
      const res = await fetch(`/api/matches/${id}`);
      if (!res.ok)
        throw new Error(
          res.status === 404
            ? "that match isn't on the board any more."
            : `the arena answered ${res.status}.`,
        );
      const detail = (await res.json()) as MatchDetail;
      if (import.meta.env.DEV && new URLSearchParams(location.search).get("plan") === "demo")
        demoPlans(detail);
      if (id !== this.id || token !== this.loading) return;
      const first = !this.detail;
      this.detail = detail;
      this.renderHead();
      if (!detail.snapshots.length) {
        $("mBody").dataset.state = "empty";
        return;
      }
      if (first) {
        const terrain = await this.terrain(detail.match.map);
        if (id !== this.id) return;
        if (terrain) this.world.setTerrain(terrain);
      }
      $("mBody").dataset.state = "ready";
      this.view.resize();
      this.renderLane();
      this.renderTurns();
      if (first) {
        this.at = -1;
        if (seq) this.selectSeq(seq);
        else this.select(detail.snapshots.length - 1);
        this.frameBase(true);
      } else if (this.follow) this.select(detail.snapshots.length - 1, true);
      else this.renderCursor();
    } catch (err) {
      if (id !== this.id) return;
      $("mBody").dataset.state = "error";
      setText($("mError"), err instanceof Error ? err.message : "couldn't load that match.");
    } finally {
      if (token === this.loading) this.loading = 0;
    }
  }

  private async terrain(map: string): Promise<TerrainModel | null> {
    const live = this.liveTerrain();
    if (live && live.map === map) return live;
    const hit = this.terrains.get(map);
    if (hit) return hit;
    try {
      const res = await fetch(`/api/terrain?map=${encodeURIComponent(map)}`);
      if (!res.ok) return null;
      const t = (await res.json()) as Terrain;
      if (!t.ready) return null;
      const model = new TerrainModel(t);
      this.terrains.set(map, model);
      return model;
    } catch {
      return null;
    }
  }

  // ---------- playback ----------

  private toggle(): void {
    const n = this.detail?.snapshots.length || 0;
    if (!n) return;
    if (this.playing) {
      this.pause();
      return;
    }
    if (this.at >= n - 1) this.select(0);
    this.playing = true;
    this.nextAt = performance.now() + STEP_MS / this.speed;
    this.syncPlay();
  }

  private pause(): void {
    this.playing = false;
    this.syncPlay();
  }

  private setSpeed(s: number): void {
    this.speed = s;
    for (const b of $("mSpeeds").children)
      b.setAttribute("aria-pressed", String(Number((b as HTMLElement).dataset.speed) === s));
    if (this.playing) this.nextAt = performance.now() + STEP_MS / s;
  }

  private syncPlay(): void {
    const b = $("mPlay");
    b.replaceChildren(icon(this.playing ? pauseIcon : playIcon));
    b.setAttribute("aria-label", this.playing ? "pause" : "play");
  }

  private step(d: number): void {
    this.pause();
    this.select(this.at + d);
  }

  private selectSeq(seq: number): void {
    const i = this.detail?.snapshots.findIndex((s) => s.seq === seq) ?? -1;
    this.select(i >= 0 ? i : (this.detail?.snapshots.length || 1) - 1);
  }

  private select(index: number, glide = false): void {
    const snaps = this.detail?.snapshots;
    if (!snaps?.length) return;
    const i = clamp(index, 0, snaps.length - 1);
    if (i === this.at) return;
    const now = performance.now();
    // One step forward glides and shows what got built. Any other move is a cut.
    const forward = i === this.at + 1 && this.world.state !== null;
    this.at = i;
    const snap = snaps[i];
    const state = this.stateOf(snap);
    if (state)
      this.world.apply(state, now, { fresh: !(forward || glide), gap: (STEP_MS / this.speed) * 0.8 });
    this.view.callsign = this.detail!.match.model;
    this.view.callsignColor = lineColor(this.detail!.match.model);
    this.renderCursor();
    this.renderTurn();
    history.replaceState(null, "", `#match/${this.id}/${snap.seq}`);

    if (now - this.touchedAt > 9000) {
      const targets = snap.actions.flatMap(actionTargets);
      if (targets.length) this.focus(targets, false);
    }
  }

  private stateOf(snap: Snapshot): State | null {
    const t = this.world.terrain;
    if (!t) return null;
    const core = snap.buildings.find((b) => b.block.startsWith("core-") && b.team === "sharded");
    return {
      ready: true,
      map: t.map,
      width: t.w,
      height: t.h,
      wave: snap.wave,
      waveTime: 99,
      enemies: snap.enemies,
      gameOver: false,
      playing: true,
      core: core ? { x: core.x, y: core.y, hp: snap.coreHp, maxHp: snap.coreMaxHp, block: core.block } : null,
      items: snap.items,
      spawns: t.spawns,
      buildings: snap.buildings,
      powerLinks: snap.powerLinks || [],
      conveyorItems: [],
      power: snap.power,
      units: snap.units,
      bullets: [],
      playerDrone: snap.playerDrone,
    };
  }

  private frameBase(snap: boolean): void {
    const core = this.world.state?.core || this.world.terrain?.core;
    if (core) this.view.lookAt(core.x + 0.5, core.y + 0.5, 24, snap);
  }

  private focus(targets: Target[], byHand: boolean): void {
    const now = performance.now();
    for (const t of targets) this.world.ping(t.x, t.y, t.ok, now);
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const t of targets) {
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x);
      y1 = Math.max(y1, t.y);
    }
    this.view.ease = byHand ? 0.12 : 0.5;
    this.view.lookAt(
      (x0 + x1) / 2 + 0.5,
      (y0 + y1) / 2 + 0.5,
      this.view.fitZoom(x1 - x0 + 16, y1 - y0 + 12, 18, 32),
    );
    if (byHand) this.touchedAt = now;
  }

  /** A slow tick: the live match's scoreline keeps moving while its breakdown is open. */
  tick(): void {
    if (this.open && this.detail && this.id === this.liveMatchId()) this.renderHead();
  }

  /** Called every animation frame while this view is on screen. */
  frame(now: number): void {
    if (!this.detail?.snapshots.length || !this.world.terrain) return;
    if (this.playing && now >= this.nextAt) {
      const n = this.detail.snapshots.length;
      if (this.at >= n - 1) this.pause();
      else {
        this.select(this.at + 1);
        this.nextAt = now + STEP_MS / this.speed;
      }
    }
    this.world.terrain.stepLow(4);
    this.world.tick(now);
    this.view.frame(now);
    if (now - this.inspectAt > 100) {
      this.inspectAt = now;
      renderInspector(this.world, this.view.hover || this.view.selected, $("mInspect"));
    }
  }

  // ---------- header ----------

  private renderHead(): void {
    const m = this.detail?.match;
    setText($("mId"), `match ${this.id}`);
    const slot = $("mTicker");
    if (m && slot.dataset.id !== m.model) {
      slot.dataset.id = m.model;
      slot.replaceChildren(tickerEl(m.model, "l"));
    } else if (!m) {
      slot.dataset.id = "";
      slot.replaceChildren();
    }
    const facts = $("mFacts");
    if (!m) {
      facts.dataset.key = "";
      facts.replaceChildren();
      return;
    }
    const total = m.actions_ok + m.actions_fail;
    const live = m.id === this.liveMatchId();
    const lasted = ((m.ended_at || (live ? Date.now() : m.started_at)) - m.started_at) / 1000;
    const fact = (label: string, value: string, alarm = false) =>
      h(
        "div",
        { class: "cell", "data-alarm": alarm ? "" : null },
        h("span", { class: "lbl" }, label),
        h("b", { class: "mid" }, value),
      );
    const end = ending(m, this.liveMatchId());
    const key = `${m.id}|${m.peak_wave}|${m.turns}|${total}|${Math.round(lasted)}|${end}`;
    if (facts.dataset.key === key) return;
    facts.dataset.key = key;
    facts.replaceChildren(
      fact("map", m.map),
      fact("reached wave", String(m.peak_wave)),
      fact("turns", m.turns ? String(m.turns) : "--"),
      fact("a turn takes", m.avg_latency_ms ? seconds(m.avg_latency_ms) : "--"),
      fact("actions landed", total ? `${m.actions_ok} / ${total}` : "--"),
      fact("lasted", lasted > 0 ? duration(lasted) : "--"),
      fact("ended", end || "finished", end === "core lost"),
    );
  }

  // ---------- timeline ----------

  private renderLane(): void {
    const tl = this.detail!.timeline;
    const snaps = this.detail!.snapshots;
    const n = tl.length;
    const W = 1000;
    const x = (i: number) => (n > 1 ? (i / (n - 1)) * W : W / 2);

    // The track: one tick per snapshot, taller where the model took a turn, red where a wave landed.
    const track = svg("svg", { viewBox: `0 0 ${W} 22`, preserveAspectRatio: "none", class: "track" });
    track.append(svg("line", { x1: 0, x2: W, y1: 11, y2: 11, class: "rail" }));
    snaps.forEach((s, i) => {
      const tall = s.kind === "turn";
      track.append(
        svg("line", {
          x1: x(i),
          x2: x(i),
          y1: tall ? 4 : 8,
          y2: tall ? 18 : 14,
          class: s.kind === "wave" ? "tick wave" : s.actions.some((a) => !a.ok) ? "tick miss" : "tick",
        }),
      );
    });

    const rows: HTMLElement[] = [h("div", { class: "lane-row lane-track" }, track)];
    const labels: HTMLElement[] = [h("div", { class: "lane-label", id: "mTrackLabel" })];
    for (const strip of STRIPS) {
      const H = 54;
      const el = svg("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", class: "strip" });
      // A series that never leaves zero in this match (graphite, usually) is left out.
      const live = (sr: Series) => tl.some((p) => sr.value(p) > 0);
      const lines = strip.series.filter(live);
      const all = [...lines, ...(strip.bars && live(strip.bars) ? [strip.bars] : [])];
      // Each series is scaled to its own peak: the strips compare shape over time, the labels carry the numbers.
      if (strip.bars) {
        const max = Math.max(1, ...tl.map(strip.bars.value));
        const bw = Math.max(2, Math.min(14, (W / Math.max(1, n)) * 0.5));
        tl.forEach((p, i) => {
          const v = strip.bars!.value(p);
          if (v <= 0) return;
          const bh = Math.max(2, (v / max) * (H - 8));
          el.append(
            svg("rect", {
              x: x(i) - bw / 2,
              y: H - bh,
              width: bw,
              height: bh,
              fill: strip.bars!.color,
              opacity: 0.85,
            }),
          );
        });
      }
      for (const s of lines) {
        const max = Math.max(1, ...tl.map(s.value));
        const y = (v: number) => H - 3 - (v / max) * (H - 10);
        let d = "";
        tl.forEach((p, i) => {
          const px = x(i);
          const py = y(s.value(p));
          if (i === 0) d += `M${px},${py}`;
          else if (s.step) d += `H${px}V${py}`;
          else d += `L${px},${py}`;
        });
        if (n === 1) d += `h1`;
        if (s.area) el.append(svg("path", { d: `${d}V${H}H${x(0)}Z`, fill: s.color, opacity: 0.14 }));
        el.append(
          svg("path", {
            d,
            fill: "none",
            stroke: s.color,
            "stroke-width": 1.5,
            "vector-effect": "non-scaling-stroke",
          }),
        );
      }
      rows.push(h("div", { class: "lane-row" }, el));
      labels.push(
        h(
          "div",
          { class: "lane-label" },
          h("b", null, strip.name),
          h(
            "span",
            { class: "vals" },
            ...all.map((s) => h("span", { style: { color: s.color }, "data-series": s.label }, s.label)),
          ),
        ),
      );
    }
    // Wave boundaries run through every strip.
    const waves = h("div", { class: "waves" });
    let wave = tl[0]?.wave ?? 1;
    tl.forEach((p, i) => {
      if (p.wave === wave) return;
      wave = p.wave;
      waves.append(
        h("i", { style: { left: `${n > 1 ? (i / (n - 1)) * 100 : 50}%` } }, h("span", null, String(p.wave))),
      );
    });
    $("mLane").replaceChildren(waves, ...rows, h("div", { class: "cursor", id: "mCursor" }));
    $("mLabels").replaceChildren(...labels);
  }

  private renderCursor(): void {
    const d = this.detail;
    if (!d?.snapshots.length) return;
    const n = d.snapshots.length;
    const cursor = document.getElementById("mCursor");
    if (cursor) cursor.style.left = `${n > 1 ? (this.at / (n - 1)) * 100 : 50}%`;
    const p = d.timeline[this.at];
    const snap = d.snapshots[this.at];
    setText($("mTrackLabel"), `step ${this.at + 1} of ${n}, wave ${snap.wave}`);
    const labels = $("mLabels").querySelectorAll<HTMLElement>("[data-series]");
    const bySeries = new Map<string, string>();
    for (const strip of STRIPS) {
      for (const s of [...strip.series, ...(strip.bars ? [strip.bars] : [])]) {
        const v = s.value(p);
        bySeries.set(s.label, strip.unit ? strip.unit(v) : s.label === "core" ? `${v}%` : num(v));
      }
    }
    for (const el of labels) setText(el, `${el.dataset.series} ${bySeries.get(el.dataset.series!) ?? ""}`);
    for (const row of $("mTurns").children)
      row.toggleAttribute("data-on", Number((row as HTMLElement).dataset.i) === this.at);
    const on = $("mTurns").querySelector<HTMLElement>("[data-on]");
    if (on) {
      // Keep the current row in view inside its own list, without scrolling the page.
      const list = $("mTurns");
      const top = on.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + on.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = top - list.clientHeight / 2 + on.offsetHeight / 2;
      }
    }
  }

  // ---------- turns ----------

  private turnName(i: number): string {
    const snaps = this.detail!.snapshots;
    const s = snaps[i];
    if (s.kind === "start") return "drop";
    if (s.kind === "wave") return `wave ${s.wave} lands`;
    if (s.kind === "end") return "the end";
    let n = 0;
    for (let k = 0; k <= i; k++) if (snaps[k].kind === "turn") n++;
    return `turn ${n}`;
  }

  private renderTurns(): void {
    const snaps = this.detail!.snapshots;
    $("mTurns").replaceChildren(
      ...snaps.map((s, i) => {
        const miss = s.actions.filter((a) => !a.ok).length;
        return h(
          "li",
          { "data-i": i, class: s.kind },
          h(
            "button",
            {
              onclick: () => {
                this.pause();
                this.select(i);
              },
            },
            h("span", { class: "tn" }, this.turnName(i)),
            h("span", { class: "tt" }, s.kind === "turn" ? s.thought || "" : ""),
            s.kind === "turn"
              ? h(
                  "span",
                  { class: miss ? "tc miss" : "tc" },
                  miss ? `${s.actions.length - miss}/${s.actions.length}` : String(s.actions.length),
                )
              : null,
          ),
        );
      }),
    );
  }

  /** What a step says. Turns carry the model's own words; the arena's steps are written here. */
  private said(s: Snapshot): string {
    const m = this.detail!.match;
    if (s.kind === "wave")
      return `wave ${s.wave} landed with ${s.enemies} hostile${s.enemies === 1 ? "" : "s"} on the field.`;
    if (s.kind === "start") return `${m.model} dropped onto ${m.map}.`;
    if (s.kind === "end")
      return (s.thought || "the match ended.").replace(/^match ended: /, "the match ended: ");
    return s.thought || "nothing was said here.";
  }

  private renderTurn(): void {
    const snaps = this.detail!.snapshots;
    const s = snaps[this.at];
    const prev = this.at > 0 ? snaps[this.at - 1] : null;
    const el = $("mTurn");
    const meta = [clock(s.ts)];
    if (s.latencyMs) meta.push(`thought for ${seconds(s.latencyMs)}`);
    if (s.promptChars) meta.push(`read ${num(s.promptChars)} chars, wrote ${num(s.outputChars)}`);

    const parts: Node[] = [
      h("header", null, h("h2", null, this.turnName(this.at)), h("p", { class: "quiet" }, meta.join(", "))),
      h("p", { class: "thought" }, this.said(s)),
    ];
    if (s.actions.length) parts.push(actionList(s.actions, (targets) => this.focus(targets, true)));

    // The plan as it stood at this step. Scrubbing shows goals arrive, get done and get stuck.
    const plan = (s.plan || []).filter((g) => g?.text);
    if (plan.length) {
      const before = new Set((prev?.plan || []).map((g) => g.text));
      const fresh = prev ? new Set(plan.filter((g) => !before.has(g.text)).map((g) => g.text)) : undefined;
      const left = plan.filter((g) => g.status !== "done").length;
      parts.push(
        h(
          "h3",
          null,
          left ? `the plan at this step, ${left} of ${plan.length} to go` : "the plan at this step, all done",
        ),
        planList(plan, (targets) => this.focus(targets, true), fresh),
      );
    }

    if (prev) {
      const chips: HTMLElement[] = [];
      const chip = (iconName: string | null, text: string, bad = false) =>
        h("li", { class: bad ? "bad" : null }, iconName ? h("img", { src: iconName, alt: "" }) : null, text);
      const sign = (v: number) => (v > 0 ? `+${num(v)}` : `−${num(-v)}`);
      for (const name of new Set([...Object.keys(s.items), ...Object.keys(prev.items)])) {
        const d = (s.items[name] || 0) - (prev.items[name] || 0);
        if (d)
          chips.push(
            chip(iconURL(`item-${name}`), `${sign(d)} ${name}`, d < 0 && (s.items[name] || 0) === 0),
          );
      }
      const count = (snap: Snapshot) => {
        const c = new Map<string, number>();
        for (const b of snap.buildings) if (b.team === "sharded") c.set(b.block, (c.get(b.block) || 0) + 1);
        return c;
      };
      const a = count(prev);
      const b = count(s);
      for (const name of new Set([...a.keys(), ...b.keys()])) {
        const d = (b.get(name) || 0) - (a.get(name) || 0);
        if (d) chips.push(chip(iconFor(name), `${sign(d)} ${name}`, d < 0));
      }
      const hp = s.coreHp - prev.coreHp;
      if (hp) chips.push(chip(null, `core ${sign(hp)} hp`, hp < 0));
      const foes = s.enemies - prev.enemies;
      if (foes) chips.push(chip(null, `${sign(foes)} hostile${Math.abs(foes) === 1 ? "" : "s"}`, foes > 0));
      parts.push(
        h("h3", null, "what changed since the step before"),
        chips.length ? h("ul", { class: "deltas" }, ...chips) : h("p", { class: "quiet" }, "nothing moved."),
      );
    }
    el.replaceChildren(...parts);
    el.scrollTop = 0;
  }
}
