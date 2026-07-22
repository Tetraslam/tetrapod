import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";

export function NullclawPage() {
  return (
    <Page
      title="nullclaw"
      intro="the box's resident agent, reachable on discord. persona and config render from the repo + vault."
    >
      <Doc title="talk to it">
        <P>
          @-mention it in the server or DM it. after a reply, wait ~4s before the next message (see
          defib). it remembers conversations and stores facts unprompted.
        </P>
      </Doc>

      <Doc title="change config or persona">
        <CodeBlock>{`~/tetrapod/provision/setup-nullclaw.sh   # re-render from vault + restart
# template: provision/nullclaw/config.json.template
# persona:  provision/nullclaw/workspace/{IDENTITY,SOUL,AGENTS}.md`}</CodeBlock>
      </Doc>

      <Doc title="the defib">
        <P>
          <Ext url="https://github.com/nullclaw/nullclaw/issues/977">nullclaw#977</Ext>: the discord
          gateway goes deaf after one handled message. workarounds: restart ~1s after every reply
          (nullclaw-defib) + recycle every 10 min for connections born deaf (RuntimeMaxSec). cold
          start to READY is ~3s, so it's livable. delete both units when upstream fixes it.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">brain</TableCell>
              <TableCell className="font-mono text-xs">
                openrouter z-ai/glm-5.2 (no :nitro — fast hosts mangle tool calls)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">tools</TableCell>
              <TableCell className="font-mono text-xs">
                <WikiLink to="searxng">searxng</WikiLink> ·{" "}
                <WikiLink to="browsers">lightpanda mcp</WikiLink> · firecrawl · context7 ·
                shell/files
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">gateway</TableCell>
              <TableCell className="font-mono text-xs">
                127.0.0.1:3000 · workspace ~/.nullclaw/workspace
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">units</TableCell>
              <TableCell className="font-mono text-xs">
                nullclaw · nullclaw-defib · nullclaw-kuma-push.timer
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">debug</TableCell>
              <TableCell className="font-mono text-xs">
                journalctl -u nullclaw -f (tools + payloads logged)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
