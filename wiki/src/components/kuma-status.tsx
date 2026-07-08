import { Activity } from "lucide-react";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KUMA_API_BASE, KUMA_REFRESH_MS, KUMA_STATUS_SLUG, URLS } from "@/config";

type Beat = { status: number; time: string; ping: number | null };

type Monitor = {
  id: number;
  name: string;
  status: "up" | "down" | "pending" | "maintenance" | "unknown";
  ping: number | null;
  uptime24h: number | null;
};

const STATUS_LABEL: Record<number, Monitor["status"]> = {
  0: "down",
  1: "up",
  2: "pending",
  3: "maintenance",
};

const STATUS_TEXT: Record<Monitor["status"], string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  pending: "text-amber-400",
  maintenance: "text-sky-400",
  unknown: "text-muted-foreground",
};

const STATUS_DOT: Record<Monitor["status"], string> = {
  up: "bg-emerald-400",
  down: "bg-red-400",
  pending: "bg-amber-400",
  maintenance: "bg-sky-400",
  unknown: "bg-muted-foreground",
};

async function fetchStatus(): Promise<Monitor[]> {
  const base = KUMA_API_BASE;
  const [pageRes, beatRes] = await Promise.all([
    fetch(`${base}/api/status-page/${KUMA_STATUS_SLUG}`),
    fetch(`${base}/api/status-page/heartbeat/${KUMA_STATUS_SLUG}`),
  ]);
  if (!pageRes.ok || !beatRes.ok) throw new Error(`kuma: ${pageRes.status}/${beatRes.status}`);
  const page = await pageRes.json();
  const beats = await beatRes.json();

  const monitors: Monitor[] = [];
  for (const group of page.publicGroupList ?? []) {
    for (const m of group.monitorList ?? []) {
      const list: Beat[] = beats.heartbeatList?.[String(m.id)] ?? [];
      const last = list.at(-1);
      const uptime = beats.uptimeList?.[`${m.id}_24`];
      monitors.push({
        id: m.id,
        name: m.name,
        status: last ? (STATUS_LABEL[last.status] ?? "unknown") : "unknown",
        ping: last?.ping ?? null,
        uptime24h: typeof uptime === "number" ? uptime : null,
      });
    }
  }
  return monitors;
}

function StatusDot({ status }: { status: Monitor["status"] }) {
  const color = STATUS_DOT[status];
  return (
    <span className="relative flex size-2">
      {status === "up" && (
        <span
          className={`absolute inline-flex size-full animate-ping rounded-full ${color} opacity-60`}
        />
      )}
      <span className={`relative inline-flex size-2 rounded-full ${color}`} />
    </span>
  );
}

export function KumaStatus() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchStatus()
        .then((m) => {
          if (alive) {
            setMonitors(m);
            setError(null);
          }
        })
        .catch((e) => alive && setError(String(e)));
    load();
    const t = setInterval(load, KUMA_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-muted-foreground text-sm">
          <Activity className="size-4" />
          <span>
            can't reach kuma's status page api — check the{" "}
            <a href={URLS.kuma} className="underline" target="_blank" rel="noreferrer">
              kuma instance
            </a>{" "}
            and the <code className="font-mono">/kuma-api</code> proxy (
            <code className="font-mono">{KUMA_STATUS_SLUG}</code> status page must exist)
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!monitors) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[74px] rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {monitors.map((m) => (
        <a
          key={m.id}
          href={URLS.kuma}
          target="_blank"
          rel="noreferrer"
          title="24h uptime · last ping"
          className="rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium text-sm">{m.name}</span>
            <StatusDot status={m.status} />
          </div>
          <div className="mt-1.5 flex items-baseline gap-2 whitespace-nowrap font-mono text-xs">
            <span className={STATUS_TEXT[m.status]}>{m.status}</span>
            {m.uptime24h !== null && (
              <span className="text-muted-foreground">{(m.uptime24h * 100).toFixed(1)}%</span>
            )}
            {m.ping !== null && (
              <span className="text-muted-foreground">{Math.round(m.ping)}ms</span>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}
