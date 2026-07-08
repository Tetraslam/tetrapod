import { KumaStatus } from "@/components/kuma-status";
import { Neofetch } from "@/components/neofetch";
import { Ext, P, WikiLink } from "@/components/wiki";
import { URLS } from "@/config";

const quick = [
  { title: "code-server", desc: "vscode in the browser", url: URLS.codeServer },
  { title: "uptime-kuma", desc: "monitors + alert history", url: URLS.kuma },
  { title: "repo", desc: "IaC, provisioning, this wiki", url: URLS.repo },
];

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
        <h2 className="font-semibold text-lg tracking-tight">status</h2>
        <KumaStatus />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg tracking-tight">specs</h2>
        <Neofetch />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg tracking-tight">quick links</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {quick.map((q) => (
            <a
              key={q.title}
              href={q.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border bg-card p-4 transition-colors hover:bg-accent/50"
            >
              <div className="font-medium text-sm">{q.title}</div>
              <div className="mt-1 text-muted-foreground text-xs">{q.desc}</div>
            </a>
          ))}
        </div>
      </section>
    </article>
  );
}
