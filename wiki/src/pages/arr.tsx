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
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;
const fqdn = HOSTS.tetrapod.fqdn;

const PARTS = [
  { name: "prowlarr", port: 9696, role: "indexers (nyaa anime, yts movies, eztv shows)" },
  { name: "sonarr", port: 8989, role: "tv + anime" },
  { name: "radarr", port: 7878, role: "movies" },
  { name: "qbittorrent", port: 8081, role: "downloads (no login on tailnet)" },
  { name: "flaresolverr", port: 8191, role: "cloudflare solver (loopback)" },
] as const;

export function ArrPage() {
  return (
    <Page
      title="arr pipeline"
      intro="prowlarr (indexers) → sonarr/radarr (what to get) → qbittorrent (fetch) → jellyfin. you interact with sonarr/radarr; the rest is automatic."
    >
      <Doc title="add a show">
        <P>
          <Ext url={`http://${fqdn}:8989`}>sonarr</Ext> → add series → enable monitoring and start
          the missing search. <InlineCode>media-reconcile</InlineCode> also classifies Japanese
          animation as anime and starts missing searches every minute, so leaving the defaults is
          safe. movies: <Ext url={`http://${fqdn}:7878`}>radarr</Ext> → add movie. available movies
          are searched automatically; unreleased movies remain monitored until a release exists.
        </P>
      </Doc>

      <Doc title="backfill old seasons by hand">
        <P>
          sonarr's own backfill search is slow (alt-title expansion) and nyaa is mostly season
          packs. faster: search <Ext url={`http://${fqdn}:9696`}>prowlarr</Ext>, feed the magnet to
          qbit under the right category — import behaves as if sonarr grabbed it:
        </P>
        <CodeBlock>{`curl -X POST http://${host}:8081/api/v2/torrents/add \\
  --data-urlencode "urls=<magnet>" --data "category=tv-sonarr"   # or category=radarr`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>part</TableHead>
              <TableHead>port</TableHead>
              <TableHead>role</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {PARTS.map((p) => (
              <TableRow key={p.name}>
                <TableCell>{p.name}</TableCell>
                <TableCell className="font-mono text-xs">{p.port}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{p.role}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">flow</TableCell>
              <TableCell className="font-mono text-xs">
                downloads/ → import → library/ → <WikiLink to="jellyfin">jellyfin</WikiLink>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">path mapping</TableCell>
              <TableCell className="font-mono text-xs">
                qbit /downloads/ ↔ /srv/media/downloads/ (remote path mappings)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">quirks set once</TableCell>
              <TableCell className="font-mono text-xs">
                size floors zeroed (hevc anime) · seed ratio 2 · 1337x disabled (AWS IP blocked) ·
                yts / eztv / nyaa enabled
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
