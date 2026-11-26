import type { Renderer } from "./renderer";
import { mmss } from "./util";
import { type BView, HOME, type World } from "./world";

type Shot = {
  x: number;
  y: number;
  z: number;
  label: string;
  rank: number;
  until: number;
  /** Take this shot even if the current one has time left. */
  cut?: boolean;
};

const RESUME_MS = 40_000;

/**
 * The observer. It picks what the camera should watch, the way a caster's observer would:
 * a fight beats fresh construction, construction beats a wave walking in, and when nothing
 * is happening it tours the base. Touching the map takes the camera away for a while.
 */
export class Director {
  /** The viewer's switch. Off means the director never moves the camera. */
  on = true;
  label = "";
  private shot: Shot | null = null;
  private heldUntil = 0;
  private tour = 0;
  private queued: { views: BView[]; at: number } | null = null;

  constructor(
    private world: World,
    private view: Renderer,
  ) {}

  /** The viewer moved the camera by hand. */
  touch(now: number): void {
    this.heldUntil = now + RESUME_MS;
    this.shot = null;
    this.view.ease = 0.08;
  }

  get held(): boolean {
    return this.heldUntil > performance.now();
  }

  reset(): void {
    this.shot = null;
    this.queued = null;
    this.tour = 0;
  }

  built(views: BView[], now: number): void {
    const mine = views.filter((v) => v.b.team === HOME);
    if (!mine.length) return;
    if (this.queued && now - this.queued.at < 2500) this.queued.views.push(...mine);
    else this.queued = { views: mine, at: now };
  }

  /** Point the camera at a tile because the viewer asked (a feed row, the minimap). */
  jump(wx: number, wy: number, now: number, z?: number): void {
    this.touch(now);
    this.view.lookAt(wx, wy, z ?? Math.max(this.view.goal.z, 24));
  }

  update(now: number): void {
    const { world, view } = this;
    const state = world.state;
    if (!state || !world.w) {
      this.label = "";
      return;
    }
    if (!this.on) {
      this.label = "director off";
      return;
    }
    if (this.heldUntil > now) {
      this.label = `yours for ${mmss((this.heldUntil - now) / 1000)}`;
      return;
    }

    const next = this.choose(now);
    if (next && (next.cut || !this.shot || now >= this.shot.until || next.rank > this.shot.rank))
      this.shot = next;
    const shot = this.shot;
    if (!shot) return;
    this.label = shot.label;
    view.ease = shot.rank === 3 ? 0.55 : 1.05;
    // An idle shot drifts a little so the picture is never frozen.
    const drift = shot.rank <= 1 ? Math.sin(now / 5200) * 1.4 : 0;
    view.lookAt(shot.x + drift, shot.y + Math.cos(now / 6100) * (shot.rank <= 1 ? 0.8 : 0), shot.z);
  }

  private frame(
    pts: Array<{ x: number; y: number }>,
    pad: number,
    lo: number,
    hi: number,
  ): { x: number; y: number; z: number } {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return {
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      z: this.view.fitZoom(x1 - x0 + pad * 2, y1 - y0 + pad * 2, lo, hi),
    };
  }

  private choose(now: number): Shot | null {
    const { world } = this;
    const state = world.state!;
    const mine: BView[] = [];
    for (const v of world.buildings.values()) if (v.b.team === HOME) mine.push(v);
    const core = state.core ? { x: state.core.x + 0.5, y: state.core.y + 0.5 } : null;
    const hostiles = world.hostiles();

    // 3. a fight: hostiles close to anything of ours, or shots in the air.
    if (hostiles.length || state.bullets.length) {
      const engaged = hostiles.filter((h) =>
        mine.some((b) => Math.abs(b.cx - h.x) < 24 && Math.abs(b.cy - h.y) < 24),
      );
      const shots = state.bullets.map((b) => ({ x: b.x + 0.5, y: b.y + 0.5 }));
      if (engaged.length || shots.length) {
        const pts = [...engaged.map((h) => ({ x: h.x, y: h.y })), ...shots];
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
        const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        // Keep the defenders that are answering in frame too.
        for (const b of mine) {
          if (b.kind === "turret" && Math.hypot(b.cx - cx, b.cy - cy) < 18) pts.push({ x: b.cx, y: b.cy });
        }
        const f = this.frame(pts, 7, 13, 30);
        return {
          ...f,
          rank: 3,
          cut: true,
          until: now + 2500,
          label: engaged.length
            ? `the fight: ${engaged.length} hostile${engaged.length === 1 ? "" : "s"} on the base`
            : "shots fired",
        };
      }
    }

    // 2. something was just built.
    if (this.queued && now - this.queued.at > 9000) this.queued = null;
    if (this.queued && now - this.queued.at > 350) {
      const views = this.queued.views;
      this.queued = null;
      const counts = new Map<string, number>();
      for (const v of views) counts.set(v.b.block, (counts.get(v.b.block) || 0) + 1);
      const what = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, n]) => (n > 1 ? `${n} ${name}` : name))
        .join(", ");
      const f = this.frame(
        views.map((v) => ({ x: v.cx, y: v.cy })),
        6,
        20,
        38,
      );
      return { ...f, rank: 2, cut: true, until: now + 7000, label: `new: ${what}` };
    }

    // 2. a wave is walking in.
    if (hostiles.length && core) {
      let lead = hostiles[0];
      let best = Number.POSITIVE_INFINITY;
      for (const h of hostiles) {
        const d = Math.hypot(h.x - core.x, h.y - core.y);
        if (d < best) {
          best = d;
          lead = h;
        }
      }
      const pack = hostiles.filter((h) => Math.hypot(h.x - lead.x, h.y - lead.y) < 14);
      const f = this.frame(
        pack.map((h) => ({ x: h.x, y: h.y })),
        9,
        14,
        24,
      );
      return {
        ...f,
        rank: 2,
        until: now + 1200,
        label: `wave ${state.wave} inbound, ${Math.round(best)} tiles from the core`,
      };
    }

    if (this.shot && now < this.shot.until) return null;

    // 1. nothing urgent: tour the base.
    const stops: Shot[] = [];
    const idle = (f: { x: number; y: number; z: number }, label: string, ms = 9000): Shot => ({
      ...f,
      label,
      rank: 1,
      until: now + ms,
    });
    if (mine.length > 1) {
      stops.push(
        idle(
          this.frame(
            mine.map((v) => ({ x: v.cx, y: v.cy })),
            6,
            11,
            30,
          ),
          `the whole base, ${mine.length} blocks`,
        ),
      );
    }
    const turrets = mine.filter((v) => v.kind === "turret");
    if (turrets.length) {
      const t = turrets[this.tour % turrets.length];
      const near = turrets.filter((o) => Math.hypot(o.cx - t.cx, o.cy - t.cy) < 9);
      const dry = near.filter((o) => o.b.ammo <= 0).length;
      stops.push(
        idle(
          this.frame(
            near.map((v) => ({ x: v.cx, y: v.cy })),
            7,
            22,
            36,
          ),
          dry ? `defence: ${dry} of ${near.length} turrets have no ammo` : `defence: ${near.length} armed`,
        ),
      );
    }
    const drills = mine.filter((v) => v.kind === "drill");
    if (drills.length) {
      const d = drills[this.tour % drills.length];
      const ore = world.terrain?.oreAt(d.b.x, d.b.y);
      stops.push(idle({ x: d.cx, y: d.cy, z: 40 }, ore ? `mining ${ore}` : "a drill", 7000));
    }
    if (core) stops.push(idle({ ...core, z: 30 }, "the core", 7000));
    const spawn = state.spawns[this.tour % Math.max(1, state.spawns.length)];
    if (spawn && state.waveTime < 20 && !state.gameOver) {
      this.tour++;
      return idle(
        { x: spawn.x + 0.5, y: spawn.y + 0.5, z: 16 },
        `the spawn, wave ${state.wave + 1} is due`,
        Math.max(3000, state.waveTime * 1000),
      );
    }
    if (!stops.length) return null;
    return stops[this.tour++ % stops.length];
  }
}
