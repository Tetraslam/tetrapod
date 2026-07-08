import { HOSTS } from "@/config";

// ascii miku (twintails included). decorative; edit freely.
const MIKU = String.raw`      /\          /\
     /  \ .-""-. /  \
    |    /      \    |
    |   | ^    ^ |   |
    |   | (o)(o) |   |
     \  |   __   |  /
      \  \  \/  /  /
       \  '.__.'  /
      .-'|      |'-.
     /   |______|   \
    |   /        \   |
    |  | ♪  ||    |  |
     \_|    ||    |_/
       |____||____|
        (__)  (__)`;

const INFO: Array<[string, string]> = [
  ["instance", HOSTS.tetrapod.instance],
  ["cpu", HOSTS.tetrapod.cpu],
  ["memory", HOSTS.tetrapod.ram],
  ["disk", HOSTS.tetrapod.disk],
  ["os", HOSTS.tetrapod.os],
  ["region", HOSTS.tetrapod.region],
  ["cost", HOSTS.tetrapod.cost],
  ["sibling", `${HOSTS.lighthouse.name} (${HOSTS.lighthouse.instance}, ${HOSTS.lighthouse.cost})`],
];

const SWATCHES = [
  "bg-neutral-500",
  "bg-red-400",
  "bg-emerald-400",
  "bg-amber-400",
  "bg-sky-400",
  "bg-fuchsia-400",
  "bg-cyan-400",
  "bg-neutral-200",
];

export function Neofetch() {
  return (
    <div className="flex flex-col gap-6 overflow-x-auto rounded-xl border bg-card p-5 font-mono text-xs leading-relaxed sm:flex-row sm:items-center sm:gap-10">
      <pre className="shrink-0 text-cyan-400/90">{MIKU}</pre>
      <div className="min-w-0">
        <div>
          <span className="text-cyan-400">tetraslam</span>
          <span className="text-muted-foreground">@</span>
          <span className="text-cyan-400">tetrapod</span>
        </div>
        <div className="text-muted-foreground">──────────────────</div>
        <dl className="mt-1 space-y-0.5">
          {INFO.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-20 shrink-0 text-cyan-400">{k}</dt>
              <dd className="text-foreground/90">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex gap-1">
          {SWATCHES.map((c) => (
            <span key={c} className={`h-3.5 w-5 rounded-[2px] ${c}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
