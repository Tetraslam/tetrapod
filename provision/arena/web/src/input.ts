import type { Pick, Renderer } from "./renderer";

export type CameraHooks = {
  /** The viewer dragged the map. */
  panned: () => void;
  /** The viewer zoomed. Return true to zoom about the centre of the view and not the pointer. */
  zoomed?: () => boolean;
};

/** Pan, wheel and pinch zoom, hover and click for one map canvas. */
export function attachCamera(view: Renderer, hooks: CameraHooks): void {
  const centred = () => hooks.zoomed?.() ?? false;
  const canvas = view.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragged = 0;
  let pinch = 0;

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sameTile = (a: Pick | null, b: Pick | null) =>
    !!a && !!b && a.kind === "tile" && b.kind === "tile" && a.x === b.x && a.y === b.y;

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
        hooks.panned();
        view.panBy(p.x - prev.x, p.y - prev.y);
        view.hover = null;
      }
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      // A pinch on a tracked camera only zooms: the ship stays in the middle.
      if (centred()) {
        if (pinch > 0) view.zoomAt(view.width / 2, view.height / 2, dist / pinch);
      } else {
        if (pinch > 0) view.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / pinch);
        view.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
      }
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
      view.selected = hit && hit.kind !== "tile" ? hit : sameTile(hit, view.selected) ? null : hit;
    }
    pinch = 0;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    if (!pointers.size) view.hover = null;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const mid = centred();
      const p = mid ? { x: view.width / 2, y: view.height / 2 } : local(e);
      const step = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
      view.zoomAt(p.x, p.y, Math.exp(-step * (e.ctrlKey ? 0.01 : 0.0016)));
    },
    { passive: false },
  );
}
