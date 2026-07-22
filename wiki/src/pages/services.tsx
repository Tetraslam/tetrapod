import { CodeBlock, InlineCode } from "@/components/code-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { FACTORIO, HOSTS, URLS } from "@/config";

// plain tailnet-http services: one row each, same treatment. anything with a
// quirk (game ports, websockets, systemd units) gets a hand-written row below.
const TAILNET_HTTP = [
  { name: "jellyfin", page: "jellyfin", port: 8096, note: "compose · media stack" },
  { name: "qbittorrent", page: "arr", port: 8081, note: "compose · media stack" },
  { name: "prowlarr", page: "arr", port: 9696, note: "compose · media stack" },
  { name: "sonarr", page: "arr", port: 8989, note: "compose · media stack" },
  { name: "radarr", page: "arr", port: 7878, note: "compose · media stack" },
  { name: "pinchflat", page: "pinchflat", port: 8945, note: "compose · media stack" },
  { name: "searxng", page: "searxng", port: 8888, note: "compose · agent stack (json api)" },
  {
    name: "steel",
    page: "browsers",
    port: 3003,
    note: "compose · agent stack (chromium fallback)",
  },
  { name: "zipline", page: "zipline", port: 3200, note: "compose · uploads" },
  { name: "shlink", page: "shlink", port: 8085, note: "compose · short links" },
] as const;

export function ServicesPage() {
  return (
    <Page
      title="services"
      intro="everything user-facing runs in docker compose; tailscale serve handles https. no watchtower — image tags are pinned, updates are deliberate."
    >
      <Doc title="change a service">
        <P>
          edit <InlineCode>provision/docker-compose.yml</InlineCode> in the repo, apply, commit:
        </P>
        <CodeBlock>{`cd ~/tetrapod
$EDITOR provision/docker-compose.yml
sudo docker compose -f provision/docker-compose.yml up -d
git add -A && git commit -m "..." && git push`}</CodeBlock>
        <P>
          the repo is the source of truth — ad-hoc changes on the box get lost on rebuild (see{" "}
          <WikiLink to="rules">rules</WikiLink>).
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>service</TableHead>
              <TableHead>address</TableHead>
              <TableHead>runs as</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <WikiLink to="factorio">factorio</WikiLink>
              </TableCell>
              <TableCell className="font-mono text-xs">{FACTORIO.connectAddress}</TableCell>
              <TableCell className="text-muted-foreground text-xs">compose (tetrapod)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>code-server</TableCell>
              <TableCell className="font-mono text-xs">
                <Ext url={URLS.codeServer}>{HOSTS.tetrapod.fqdn}</Ext>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">compose → serve :8443</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>this wiki</TableCell>
              <TableCell className="font-mono text-xs">
                <Ext url={URLS.wikiPublic}>wiki.tetraslam.world</Ext> · {URLS.wiki}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                vercel (public) + serve /wiki (tailnet), same source
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>kuma api proxy</TableCell>
              <TableCell className="font-mono text-xs">/kuma-api → lighthouse</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                nginx (compose) → serve path
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <WikiLink to="monitoring">uptime-kuma</WikiLink>
              </TableCell>
              <TableCell className="font-mono text-xs">
                <Ext url={URLS.kuma}>{HOSTS.lighthouse.fqdn}</Ext>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                docker on lighthouse (cloud-init)
              </TableCell>
            </TableRow>
            {TAILNET_HTTP.map((s) => (
              <TableRow key={s.name}>
                <TableCell>{s.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  <Ext url={`http://${HOSTS.tetrapod.fqdn}:${s.port}`}>
                    {HOSTS.tetrapod.name}:{s.port}
                  </Ext>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">{s.note}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell>mindustry</TableCell>
              <TableCell className="font-mono text-xs">{HOSTS.tetrapod.fqdn}:6567</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                compose (temurin jre + pinned server jar)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>lightpanda</TableCell>
              <TableCell className="font-mono text-xs">ws://{HOSTS.tetrapod.name}:9222</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                systemd · CDP for agents (mcp on :9223, loopback)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <WikiLink to="agents">nullclaw</WikiLink>
              </TableCell>
              <TableCell className="font-mono text-xs">discord · 127.0.0.1:3000</TableCell>
              <TableCell className="text-muted-foreground text-xs">
                systemd · defib workaround for upstream #977
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
