import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;

export function BrowsersPage() {
  return (
    <Page
      title="browsers"
      intro="two headless browsers for agents: lightpanda (fast, incomplete engine) and steel (full chromium). try lightpanda first."
    >
      <Doc title="lightpanda">
        <P>
          from-scratch zig browser, ~10x faster and ~16x lighter than headless chrome. speaks CDP:
        </P>
        <CodeBlock>{`puppeteer.connect({ browserWSEndpoint: "ws://${host}:9222" })
lightpanda fetch --dump markdown <url>      # one-shot, on the box`}</CodeBlock>
        <P>js-heavy SPAs can trip its young engine — use steel for those.</P>
      </Doc>

      <Doc title="steel">
        <CodeBlock>{`curl -X POST http://${host}:3003/v1/scrape \\
  -H 'Content-Type: application/json' \\
  -d '{"url": "https://example.com", "format": ["markdown"]}'`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">lightpanda CDP</TableCell>
              <TableCell className="font-mono text-xs">
                ws://{host}:9222 · systemd: lightpanda
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">lightpanda MCP</TableCell>
              <TableCell className="font-mono text-xs">
                127.0.0.1:9223/mcp · systemd: lightpanda-mcp (nullclaw's)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">steel</TableCell>
              <TableCell className="font-mono text-xs">
                {host}:3003 · compose, digest-pinned
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">update lightpanda</TableCell>
              <TableCell className="font-mono text-xs">
                rm /usr/local/bin/lightpanda → re-run bootstrap (nightly binary)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
