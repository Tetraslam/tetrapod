import { Database, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { STORAGE_API_URL, STORAGE_REFRESH_MS } from "@/config";

type StorageData = {
  generated_at: string;
  storage: { total_bytes: number; used_bytes: number; free_bytes: number; used_percent: number };
  downloads: { incomplete_count: number | null; pending_bytes: number | null };
  forecast: { used_bytes: number | null; used_percent: number | null };
  largest_titles: { title: string; type: "series" | "movie"; size_bytes: number }[];
  warnings: string[];
};

function valid(data: unknown): data is StorageData {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<StorageData>;
  const nullableNumber = (item: unknown) => item === null || typeof item === "number";
  return (
    typeof value.generated_at === "string" &&
    typeof value.storage?.total_bytes === "number" &&
    typeof value.storage.used_bytes === "number" &&
    typeof value.storage.free_bytes === "number" &&
    typeof value.storage.used_percent === "number" &&
    nullableNumber(value.downloads?.incomplete_count) &&
    nullableNumber(value.downloads?.pending_bytes) &&
    nullableNumber(value.forecast?.used_bytes) &&
    nullableNumber(value.forecast?.used_percent) &&
    Array.isArray(value.largest_titles) &&
    value.largest_titles.every(
      (title) =>
        typeof title.title === "string" &&
        (title.type === "series" || title.type === "movie") &&
        typeof title.size_bytes === "number",
    ) &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string")
  );
}

function bytes(value: number | null): string {
  if (value === null) return "unknown";
  if (value === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** unit).toFixed(unit < 3 ? 0 : 1)} ${units[unit]}`;
}

function Bar({
  label,
  value,
  detail,
  forecast = false,
}: {
  label: string;
  value: number;
  detail: string;
  forecast?: boolean;
}) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{detail}</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${forecast ? "bg-chart-2" : "bg-primary"}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function StorageTelemetry() {
  const [data, setData] = useState<StorageData | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      try {
        const response = await fetch(STORAGE_API_URL, { signal: requestController.signal });
        const value: unknown = await response.json();
        if (!response.ok || !valid(value)) throw new Error("storage telemetry unavailable");
        if (alive) {
          setData(value);
          setFailed(false);
        }
      } catch {
        if (alive && !requestController.signal.aborted) setFailed(true);
      }
    };
    void load();
    const timer = window.setInterval(load, STORAGE_REFRESH_MS);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (!data && !failed) return <Skeleton className="h-64 rounded-xl" />;

  if (!data) {
    return (
      <div className="flex items-center gap-3 rounded-xl border bg-card p-4 text-muted-foreground text-sm">
        <Database className="size-4 shrink-0" />
        storage telemetry is unavailable. the dashboard will retry automatically.
      </div>
    );
  }

  const forecastKnown = data.forecast.used_bytes !== null && data.forecast.used_percent !== null;
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-lg">{bytes(data.storage.used_bytes)} used</p>
              <p className="text-muted-foreground text-xs">
                {bytes(data.storage.free_bytes)} free of {bytes(data.storage.total_bytes)}
              </p>
            </div>
            {(failed || data.warnings.length > 0) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-amber-600 text-[10px] dark:text-amber-400">
                {failed ? <RefreshCw className="size-3" /> : <TriangleAlert className="size-3" />}
                {failed ? "stale data" : "partial data"}
              </span>
            )}
          </div>
          <Bar
            label="current"
            value={data.storage.used_percent}
            detail={`${data.storage.used_percent.toFixed(1)}%`}
          />
          {forecastKnown ? (
            <Bar
              label="after pending downloads"
              value={data.forecast.used_percent as number}
              detail={`${bytes(data.forecast.used_bytes)} / ${(data.forecast.used_percent as number).toFixed(1)}%`}
              forecast
            />
          ) : (
            <p className="text-muted-foreground text-xs">
              download forecast is temporarily unavailable.
            </p>
          )}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            <div className="bg-background p-3">
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                incomplete
              </p>
              <p className="mt-1 font-semibold">{data.downloads.incomplete_count ?? "-"}</p>
            </div>
            <div className="bg-background p-3">
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                pending
              </p>
              <p className="mt-1 font-semibold">{bytes(data.downloads.pending_bytes)}</p>
            </div>
          </div>
        </div>

        <div className="min-w-0 border-t pt-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <p className="mb-3 font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
            largest titles
          </p>
          {data.largest_titles.length ? (
            <ol className="space-y-2.5">
              {data.largest_titles.map((title, index) => (
                <li
                  key={`${title.type}-${title.title}`}
                  className="flex min-w-0 items-baseline gap-2 text-sm"
                >
                  <span className="w-3 shrink-0 text-muted-foreground text-xs">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate" title={title.title}>
                    {title.title}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {bytes(title.size_bytes)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted-foreground text-xs">
              title sizes are temporarily unavailable.
            </p>
          )}
        </div>
      </div>
      <div className="border-t bg-muted/30 px-4 py-2 text-muted-foreground text-[10px] sm:px-5">
        updated {new Date(data.generated_at).toLocaleString()}
        {failed && "; showing the last successful response"}
      </div>
    </div>
  );
}
