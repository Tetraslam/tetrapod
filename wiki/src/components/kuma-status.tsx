import { Activity, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KUMA_REFRESH_MS, KUMA_STATUS_SLUG, URLS } from "@/config";

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

async function fetchStatus(): Promise<Monitor[]> {
  const base = URLS.kuma;
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
  const color =
    status === "up"
      ? "bg-emerald-500"
      : status === "down"
        ? "bg-red-500"
        : status === "pending"
          ? "bg-amber-500"
          : "bg-muted-foreground";
  return (
    <span className="relative flex size-2.5">
      {status === "up" && (
        <span
          className={`absolute inline-flex size-full animate-ping rounded-full ${color} opacity-60`}
        />
      )}
      <span className={`relative inline-flex size-2.5 rounded-full ${color}`} />
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
            can't reach kuma's status page — create one at{" "}
            <a href={URLS.kuma} className="underline" target="_blank" rel="noreferrer">
              {URLS.kuma}
            </a>{" "}
            (Status Pages → New, slug <code className="font-mono">{KUMA_STATUS_SLUG}</code>, add all
            monitors)
          </span>
        </CardContent>
      </Card>
    );
  }

  if (!monitors) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {monitors.map((m) => (
        <a
          key={m.id}
          href={URLS.kuma}
          target="_blank"
          rel="noreferrer"
          className="group rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">{m.name}</span>
            <StatusDot status={m.status} />
          </div>
          <div className="mt-2 flex items-baseline gap-2 text-muted-foreground text-xs">
            <Badge variant={m.status === "up" ? "secondary" : "destructive"} className="px-1.5">
              {m.status}
            </Badge>
            {m.uptime24h !== null && <span>{(m.uptime24h * 100).toFixed(1)}% 24h</span>}
            {m.ping !== null && <span>{m.ping}ms</span>}
            <ExternalLink className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </a>
      ))}
    </div>
  );
}
