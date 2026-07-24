import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference } from "@/components/wiki";
import { URLS } from "@/config";

const SERVICE_LINKS = [
  "wiki",
  "status",
  "code",
  "jellyfin",
  "qbittorrent",
  "prowlarr",
  "sonarr",
  "radarr",
  "pinchflat",
  "searxng",
  "steel",
  "zipline",
  "shlink",
] as const;

export function ShlinkPage() {
  return (
    <Page
      title="shlink"
      intro="short links and visit analytics at link.tetraslam.world (+ .com), with a tiny CLI and a tailnet-only management UI."
    >
      <Doc title="create a link">
        <CodeBlock>{`shlink https://example.com/long/thing
shlink https://example.com/long/thing memorable-slug`}</CodeBlock>
        <P>
          open <Ext url={URLS.shlinkWeb}>the web client</Ext> to manage links, tags, redirects,
          visits, and server settings. the laptop command securely runs against tetrapod over SSH;
          the API key stays on the box.
        </P>
      </Doc>

      <Doc title="service shortcuts">
        <P>
          stable links are provisioned at{" "}
          <InlineCode>link.tetraslam.world/&lt;service&gt;</InlineCode>. tailnet-only targets still
          require tailscale.
        </P>
        <CodeBlock>
          {SERVICE_LINKS.map((service) => `https://link.tetraslam.world/${service}`).join("\n")}
        </CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">shlinkio/shlink:5.1.5</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">db</TableCell>
              <TableCell className="font-mono text-xs">
                sqlite in /opt/tetrapod/shlink (in backups)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">public route</TableCell>
              <TableCell className="font-mono text-xs">
                vercel host-route → funnel :10000/lnk/ → share-proxy → shlink
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">web client</TableCell>
              <TableCell className="font-mono text-xs">
                <Ext url={URLS.shlinkWeb}>tetrapod:8086</Ext> · shlink-web-client:4.8.0
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">api key</TableCell>
              <TableCell className="font-mono text-xs">
                <InlineCode>/opt/tetrapod/shlink.env</InlineCode> · health: GET /rest/health
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
