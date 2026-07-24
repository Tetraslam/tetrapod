import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;

export function SearxngPage() {
  return (
    <Page
      title="searxng"
      intro="private metasearch with a json api. every agent on the box searches through it."
    >
      <Doc title="use it">
        <P>
          <Ext url={`http://${HOSTS.tetrapod.fqdn}:8888`}>{host}:8888</Ext>. agents (including{" "}
          <WikiLink to="nullclaw">nullclaw</WikiLink>'s web_search) hit the json api:
        </P>
        <CodeBlock>{`curl "http://${host}:8888/search?q=lightpanda&format=json" | jq '.results[0]'`}</CodeBlock>
      </Doc>

      <Doc title="agent tools">
        <P>
          nullclaw and OpenCode share a loopback <InlineCode>mcp-searxng@1.11.1</InlineCode>
          service. it adds web search, suggestions, instance discovery, and URL reading without a
          third-party search API.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                searxng/searxng:2026.7.19-6da6eee26
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">config</TableCell>
              <TableCell className="font-mono text-xs">
                provision/searxng/settings.yml (limiter off — single user)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">secret</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/searxng.env (bootstrap-generated)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
