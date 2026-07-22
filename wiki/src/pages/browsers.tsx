import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;

export function BrowsersPage() {
  return (
    <Page
      title="browsers"
      intro="two headless browsers for agents and scripts: lightpanda when you want fast, steel when you want chromium-grade compatibility. try the fast one first."
    >
      <Doc title="lightpanda (fast)">
        <P>
          a from-scratch zig browser — ~10x faster page loads, ~16x less memory than headless
          chrome. speaks CDP, so puppeteer/playwright just point at it:
        </P>
        <CodeBlock>{`const browser = await puppeteer.connect({ browserWSEndpoint: "ws://${host}:9222" });
// or one-shot: lightpanda fetch --dump markdown <url>   (on the box)`}</CodeBlock>
        <P>
          young engine: js-heavy SPAs can trip it. that's what steel is for. nightly binary — to
          update, delete <InlineCode>/usr/local/bin/lightpanda</InlineCode> and re-run bootstrap.
        </P>
      </Doc>

      <Doc title="steel (compatible)">
        <P>
          real chromium behind an agent-friendly sessions api. slower, heavier, renders everything:
        </P>
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
                ws://{host}:9222 (systemd: lightpanda)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">lightpanda MCP</TableCell>
              <TableCell className="font-mono text-xs">
                127.0.0.1:9223/mcp (systemd: lightpanda-mcp, nullclaw's copy)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">steel api</TableCell>
              <TableCell className="font-mono text-xs">
                {host}:3003 (compose, digest-pinned — ghcr only ships :latest)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
