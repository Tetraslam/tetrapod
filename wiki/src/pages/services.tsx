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

const services = [
  {
    name: "factorio",
    page: "factorio",
    address: FACTORIO.connectAddress,
    purpose: "persistent multiplayer factory",
  },
  {
    name: "code-server",
    url: URLS.codeServer,
    address: HOSTS.tetrapod.fqdn,
    purpose: "VS Code in the browser",
  },
  {
    name: "this wiki",
    url: URLS.wikiPublic,
    address: "wiki.tetraslam.world",
    purpose: "machine docs and dashboard",
  },
  {
    name: "uptime-kuma",
    url: URLS.kuma,
    address: HOSTS.lighthouse.fqdn,
    purpose: "health checks and alert history",
  },
  {
    name: "jellyfin",
    url: URLS.jellyfin,
    address: "tetrapod:8096",
    purpose: "watch movies, shows, and YouTube",
  },
  {
    name: "qbittorrent",
    url: URLS.qbittorrent,
    address: "tetrapod:8081",
    purpose: "torrent downloads",
  },
  {
    name: "prowlarr",
    url: URLS.prowlarr,
    address: "tetrapod:9696",
    purpose: "search indexers for the arr apps",
  },
  {
    name: "sonarr",
    url: URLS.sonarr,
    address: "tetrapod:8989",
    purpose: "find and organize shows + anime",
  },
  {
    name: "radarr",
    url: URLS.radarr,
    address: "tetrapod:7878",
    purpose: "find and organize movies",
  },
  {
    name: "pinchflat",
    url: URLS.pinchflat,
    address: "tetrapod:8945",
    purpose: "archive YouTube channels",
  },
  {
    name: "searxng",
    url: URLS.searxng,
    address: "tetrapod:8888",
    purpose: "private web search for people + agents",
  },
  {
    name: "steel",
    url: URLS.steel,
    address: "tetrapod:3003",
    purpose: "full Chromium for difficult agent browsing",
  },
  {
    name: "zipline",
    url: URLS.zipline,
    address: "i.tetraslam.world",
    purpose: "upload and share files + screenshots",
  },
  {
    name: "shlink",
    url: URLS.shlinkWeb,
    address: "link.tetraslam.world",
    purpose: "short links and visit analytics",
  },
  {
    name: "mindustry",
    address: `${HOSTS.tetrapod.fqdn}:6567`,
    purpose: "persistent multiplayer server",
  },
  {
    name: "lightpanda",
    page: "browsers",
    address: "ws://tetrapod:9222",
    purpose: "fast browser engine for agents",
  },
  {
    name: "nullclaw",
    page: "nullclaw",
    address: "Discord",
    purpose: "tetrapod's social agent",
  },
] as const;

function ServiceName({ service }: { service: (typeof services)[number] }) {
  if ("url" in service) return <Ext url={service.url}>{service.name}</Ext>;
  if ("page" in service) return <WikiLink to={service.page}>{service.name}</WikiLink>;
  return service.name;
}

export function ServicesPage() {
  return (
    <Page
      title="services"
      intro="the things tetrapod runs, what each one is for, and where to open it. web links are tailnet-only unless they use a public tetraslam.world domain."
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
          the repo is the source of truth. ad-hoc changes on the box get lost on rebuild (see{" "}
          <WikiLink to="rules">rules</WikiLink>).
        </P>
      </Doc>

      <Reference>
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">service</TableHead>
              <TableHead className="w-44">address</TableHead>
              <TableHead>what it does</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.name}>
                <TableCell className="whitespace-normal">
                  <ServiceName service={service} />
                </TableCell>
                <TableCell className="break-words font-mono text-xs whitespace-normal">
                  {service.address}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs whitespace-normal">
                  {service.purpose}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
