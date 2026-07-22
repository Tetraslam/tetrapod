import { CodeBlock, InlineCode } from "@/components/code-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, Steps, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;
const fqdn = HOSTS.tetrapod.fqdn;

const PARTS = [
  { name: "prowlarr", port: 9696, role: "indexer hub — one place to manage trackers" },
  { name: "sonarr", port: 8989, role: "tv/anime: tracks series, grabs new episodes" },
  { name: "radarr", port: 7878, role: "movies" },
  { name: "qbittorrent", port: 8081, role: "download client (no login on the tailnet)" },
  { name: "flaresolverr", port: 8191, role: "cloudflare solver (loopback; aws IPs get carded)" },
] as const;

export function ArrPage() {
  return (
    <Page
      title="arr pipeline"
      intro="five containers, one machine: prowlarr knows the indexers, sonarr/radarr know what you want, qbittorrent fetches it, jellyfin serves it. you interact with exactly one step."
    >
      <Doc title="add a show">
        <Steps>
          <li>
            <Ext url={`http://${fqdn}:8989`}>sonarr</Ext> → add series — for anime, set series type
            to <InlineCode>anime</InlineCode> in the add dialog
          </li>
          <li>that's it. search, download, rename, import are automatic</li>
          <li>
            movies: same flow in <Ext url={`http://${fqdn}:7878`}>radarr</Ext>
          </li>
        </Steps>
      </Doc>

      <Doc title="when automation finds nothing">
        <P>
          backfilling an old season of anime? sonarr's per-episode searches crawl (it expands every
          alt title) and nyaa is mostly season packs. skip the fight: search{" "}
          <Ext url={`http://${fqdn}:9696`}>prowlarr</Ext> by hand, then feed the magnet to
          qbittorrent under sonarr's category — import happens as if sonarr grabbed it:
        </P>
        <CodeBlock>{`curl -X POST http://${host}:8081/api/v2/torrents/add \\
  --data-urlencode "urls=<magnet>" --data "category=tv"   # movies: category=movies`}</CodeBlock>
      </Doc>

      <Doc title="indexers and cloudflare">
        <P>
          nyaa answers aws IPs directly; most other public trackers hide behind cloudflare, so they
          route through flaresolverr (prowlarr tag <InlineCode>cf</InlineCode>). 1337x and eztv are
          configured but benched — re-enable them in prowlarr if nyaa ever isn't enough.
        </P>
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
        <P>
          plumbing that already happened, so nobody re-debugs it: qbit paths map via sonarr/radarr
          remote path mappings (<InlineCode>/downloads/</InlineCode> ↔{" "}
          <InlineCode>/srv/media/downloads/</InlineCode>), quality-size floors are zeroed (HEVC
          anime encodes are "too small" for the defaults), seed ratio caps at 2. downloads land in{" "}
          <InlineCode>/srv/media/downloads</InlineCode>, imports in{" "}
          <InlineCode>/srv/media/library</InlineCode> → <WikiLink to="jellyfin">jellyfin</WikiLink>.
        </P>
      </Reference>
    </Page>
  );
}
