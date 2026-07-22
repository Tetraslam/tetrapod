import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";

export function NullclawPage() {
  return (
    <Page
      title="nullclaw"
      intro="the resident agent — tetrapod itself, on discord. a tiny zig binary with the box's tools, shresht's context, and a no-slop personality."
    >
      <Doc title="talk to it">
        <P>
          @-mention it in the server, or just DM it. after it replies, give it a beat (~4s) before
          the next message — see "the defib" below for why. it remembers conversations (sqlite) and
          stores facts you tell it.
        </P>
      </Doc>

      <Doc title="tools it carries">
        <P>
          web search via <WikiLink to="searxng">searxng</WikiLink>, browsing via{" "}
          <WikiLink to="browsers">lightpanda</WikiLink> (mcp), scraping via firecrawl (remote mcp),
          library docs via context7, plus shell and files inside its workspace.
        </P>
      </Doc>

      <Doc title="config and persona">
        <P>everything renders from the vault — nothing secret in the repo:</P>
        <CodeBlock>{`~/tetrapod/provision/setup-nullclaw.sh   # re-render config + restart
# template: provision/nullclaw/config.json.template
# persona:  provision/nullclaw/workspace/{IDENTITY,SOUL,AGENTS}.md
# user context: synced memory files copied into ~/.nullclaw/workspace/context/`}</CodeBlock>
      </Doc>

      <Doc title="the defib">
        <P>
          upstream bug (
          <Ext url="https://github.com/nullclaw/nullclaw/issues/977">nullclaw#977</Ext>): the
          discord gateway goes deaf after handling one message — frames arrive and are read, then
          silently discarded. two workarounds keep it usable: a journal-watching unit restarts the
          service ~1s after every discord reply, and <InlineCode>RuntimeMaxSec=600</InlineCode>{" "}
          recycles connections that were born deaf. cold start to discord READY is ~3s, which is the
          only reason this is livable. delete both when upstream fixes it.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">brain</TableCell>
              <TableCell className="font-mono text-xs">
                z-ai/glm-5.2 via openrouter ("experiments" key) — no :nitro, fast providers mangle
                tool calls
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">gateway</TableCell>
              <TableCell className="font-mono text-xs">127.0.0.1:3000 (loopback only)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">units</TableCell>
              <TableCell className="font-mono text-xs">
                nullclaw · nullclaw-defib · nullclaw-kuma-push.timer
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">workspace</TableCell>
              <TableCell className="font-mono text-xs">~/.nullclaw/workspace</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">logs</TableCell>
              <TableCell className="font-mono text-xs">
                journalctl -u nullclaw -f (tool calls + payloads logged)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
