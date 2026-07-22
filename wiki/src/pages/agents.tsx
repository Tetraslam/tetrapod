import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference, WikiLink } from "@/components/wiki";
import { GOG_ACCOUNTS } from "@/config";

export function AgentsPage() {
  return (
    <Page
      title="agents & ai"
      intro={
        <>
          opencode and claude code are installed with full user context — agents spawning here know
          who tetraslam is and what this box is. the box also has a resident:{" "}
          <WikiLink to="nullclaw">nullclaw</WikiLink>, with{" "}
          <WikiLink to="browsers">headless browsers</WikiLink> and{" "}
          <WikiLink to="searxng">searxng</WikiLink> to lean on.
        </>
      }
    >
      <Doc title="run an agent">
        <P>
          always inside zellij (see <WikiLink to="connecting">connecting</WikiLink>) so sessions
          survive disconnects:
        </P>
        <CodeBlock>{`zellij attach --create agents
opencode        # or: clod (claude, yolo mode)`}</CodeBlock>
      </Doc>

      <Doc title="how context works">
        <P>
          <InlineCode>~/.config/opencode/AGENTS.md</InlineCode> and{" "}
          <InlineCode>~/.claude/CLAUDE.md</InlineCode> symlink into the repo, so{" "}
          <InlineCode>git pull</InlineCode> updates instructions live. memory files (user profile,
          style, machine manual) sync from the private rice repo:
        </P>
        <CodeBlock>{`~/tetrapod/provision/setup-agents.sh   # idempotent; re-run to refresh`}</CodeBlock>
        <P>
          machine-specific knowledge belongs in{" "}
          <InlineCode>provision/agent/memory/reference_tetrapod.md</InlineCode> (edit + commit); the
          laptop-synced files get overwritten on refresh.
        </P>
      </Doc>

      <Doc title="gog (google workspace cli)">
        <CodeBlock>{`gog-env                                  # keyring password via opa, once per shell
gog gmail search "newer_than:1d" --client personal --account bhowmickshresht@gmail.com`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">instructions</TableCell>
              <TableCell className="font-mono text-xs">
                provision/agent/AGENTS.md (symlinked into both agents)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">memory</TableCell>
              <TableCell className="font-mono text-xs">
                ~/.claude/projects/-home-tetraslam/memory/
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">opencode config</TableCell>
              <TableCell className="font-mono text-xs">
                rendered from provision/agent/opencode.json.template (firecrawl key via opa)
              </TableCell>
            </TableRow>
            {GOG_ACCOUNTS.map((a) => (
              <TableRow key={a.email}>
                <TableCell className="text-muted-foreground">gog</TableCell>
                <TableCell className="font-mono text-xs">
                  {a.email} — {a.client}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="text-muted-foreground">hermes-agent</TableCell>
              <TableCell className="font-mono text-xs">
                not installed yet (bootstrap stub)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          differences from the laptop: no litellm provider (proxy on another tailnet), no
          claude-peers, playwright mcp disabled until chromium is installed.
        </P>
      </Reference>
    </Page>
  );
}
