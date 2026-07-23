import { KumaStatus } from "@/components/kuma-status";
import { Neofetch } from "@/components/neofetch";
import { Ext, P, WikiLink } from "@/components/wiki";
import { URLS } from "@/config";

const quick = [
  {
    title: "make",
    links: [
      ["code", URLS.codeServer],
      ["upload", URLS.zipline],
      ["shorten", URLS.shlinkWeb],
    ],
  },
  {
    title: "media",
    links: [
      ["watch", URLS.jellyfin],
      ["shows", URLS.sonarr],
      ["movies", URLS.radarr],
      ["youtube", URLS.pinchflat],
      ["downloads", URLS.qbittorrent],
      ["indexers", URLS.prowlarr],
    ],
  },
  {
    title: "agents",
    links: [
      ["search", URLS.searxng],
      ["browser", URLS.steel],
    ],
  },
  {
    title: "operate",
    links: [
      ["status", URLS.kuma],
      ["services", "#/services"],
      ["repo", URLS.repo],
    ],
  },
] as const;

export function HomePage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">tetrapod</h1>
        <P>
          the always-on box. tailnet-only, reproducible from <Ext url={URLS.repo}>the repo</Ext>.
          start with <WikiLink to="connecting">connecting</WikiLink>, or send friends to{" "}
          <WikiLink to="factorio">factorio</WikiLink>.
        </P>
      </header>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg tracking-tight">specs</h2>
        <Neofetch />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg tracking-tight">quick links</h2>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {quick.map((group) => (
            <div key={group.title} className="bg-background p-3">
              <h3 className="mb-2 font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                {group.title}
              </h3>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {group.links.map(([label, url]) => (
                  <a
                    key={label}
                    href={url}
                    target={url.startsWith("#") ? undefined : "_blank"}
                    rel={url.startsWith("#") ? undefined : "noreferrer"}
                    className="text-sm underline decoration-muted-foreground/40 underline-offset-3 hover:decoration-foreground"
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg tracking-tight">status</h2>
        <KumaStatus />
      </section>
    </article>
  );
}
