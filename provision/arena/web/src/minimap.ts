import type { Renderer } from "./renderer";
import { reducedMotion } from "./util";
import { HOME, teamColor, type World } from "./world";

/** The corner map: whole battlefield, where the camera is, and a click to send it somewhere. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private lastDraw = 0;
  private scale = 1;
  private size = { w: 0, h: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private view: Renderer,
    private onJump: (wx: number, wy: number) => void,
  ) {
    this.ctx = canvas.getContext("2d")!;
    let down = false;
    const go = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      if (!world.w) return;
      const mx = ((e.clientX - r.left) / r.width) * world.w;
      const my = ((e.clientY - r.top) / r.height) * world.h;
      this.onJump(mx, world.h - my);
    };
    canvas.addEventListener("pointerdown", (e) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      go(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down) go(e);
    });
    const up = () => {
      down = false;
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  /** Size the canvas to the map's proportions inside its box. */
  private layout(): void {
    const { world, canvas } = this;
    const box = canvas.parentElement!.getBoundingClientRect();
    const max = Math.max(box.width, 1);
    const ratio = world.w / world.h;
    const w = ratio >= 1 ? max : max * ratio;
    const h = ratio >= 1 ? max / ratio : max;
    if (Math.abs(w - this.size.w) < 0.5 && Math.abs(h - this.size.h) < 0.5) return;
    this.size = { w, h };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.scale = canvas.width / world.w;
  }

  draw(now: number): void {
    if (now - this.lastDraw < 90) return;
    this.lastDraw = now;
    const { ctx, world, canvas } = this;
    const t = world.terrain;
    if (!t || !world.w) return;
    this.layout();
    const k = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(t.lowReady ? t.low : t.base, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(t.dark, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(6,5,4,0.28)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const dot = Math.max(1.6, k);
    for (const v of world.buildings.values()) {
      ctx.fillStyle =
        v.b.team === HOME ? (v.kind === "conveyor" ? "#c9b98f" : "#ffd37f") : teamColor(v.b.team);
      const s = Math.max(dot, v.b.size * k);
      ctx.fillRect(v.cx * k - s / 2, (world.h - v.cy) * k - s / 2, s, s);
    }
    const beat = reducedMotion() ? 0.5 : (now / 1400) % 1;
    for (const sp of world.state?.spawns || t.spawns) {
      const x = (sp.x + 0.5) * k;
      const y = (world.h - sp.y - 0.5) * k;
      ctx.strokeStyle = `rgba(242,85,85,${1 - beat})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 3 + beat * 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#f25555";
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const u of world.units.values()) {
      ctx.fillStyle = teamColor(u.u.team);
      const s = Math.max(3, k * 1.6);
      ctx.fillRect(u.x * k - s / 2, (world.h - u.y) * k - s / 2, s, s);
    }
    for (const f of world.fx) {
      if (f.t !== "ping") continue;
      const age = (now - f.born) / f.life;
      ctx.strokeStyle = f.ok ? "#ffd37f" : "#f25555";
      ctx.globalAlpha = 1 - age;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(f.x * k - 4, (world.h - f.y) * k - 4, 8, 8);
      ctx.globalAlpha = 1;
    }

    const r = this.view.viewRect();
    const x = Math.max(0, r.x * k);
    const y = Math.max(0, r.y * k);
    const w = Math.min(canvas.width, (r.x + r.w) * k) - x;
    const h = Math.min(canvas.height, (r.y + r.h) * k) - y;
    ctx.strokeStyle = "#efe9dc";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, Math.max(2, w - 2), Math.max(2, h - 2));
  }
}
