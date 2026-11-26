import { h } from "./util";

/**
 * Every model is a line on the board: one colour and one letter that never change,
 * the way a subway route keeps its disc. The exact ticker is always printed next to it.
 */
const LINES: Record<string, string> = {
  "openai/gpt-6.2-astra": "#4a90f0",
  "openai/gpt-6.1-terra": "#35a56b",
  "openai/gpt-6.2-sol": "#f07a2b",
  "openai/gpt-6-luna": "#a9b0b8",
  "claude-agent/claude-sonnet-5": "#b565d6",
  "claude-agent/claude-opus-5": "#a8743a",
  "claude-agent/claude-fable-5-2": "#e2649f",
  "claude-agent/claude-haiku-4-5-20251001": "#22b1ac",
};

const SPARE = ["#7f8de0", "#c9a13b", "#5fa8c9", "#c4755c", "#8fae4a", "#b48ad0"];

export function lineColor(id: string): string {
  const known = LINES[id];
  if (known) return known;
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return SPARE[n % SPARE.length];
}

/** The letter on the disc: first letter of the model's family name ("astra", "sonnet", "opus"). */
export function lineLetter(id: string): string {
  const name = id.slice(id.indexOf("/") + 1);
  const word = name
    .split(/[-_.[\]]/)
    .find((part) => /^[a-z]{3,}$/i.test(part) && !["gpt", "claude", "gemini", "model"].includes(part));
  return (word || name || "?").charAt(0).toUpperCase();
}

export function isModelId(id: string | undefined): id is string {
  return !!id && id.includes("/");
}

export function disc(id: string, size: "s" | "m" | "l" = "m"): HTMLElement {
  return h("span", {
    class: `disc disc-${size}`,
    style: { background: lineColor(id) },
    "aria-hidden": "true",
    text: lineLetter(id),
  });
}

/** Disc plus the exact ticker, with the provider prefix a step quieter. */
export function tickerEl(id: string, size: "s" | "m" | "l" = "m"): HTMLElement {
  const slash = id.indexOf("/");
  const el = h("span", { class: `ticker ticker-${size}` }, disc(id, size));
  const code = h("code", null);
  if (slash > 0)
    code.append(h("span", { class: "provider", text: id.slice(0, slash + 1) }), id.slice(slash + 1));
  else code.append(id);
  el.append(code);
  return el;
}
