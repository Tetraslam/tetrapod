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
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
