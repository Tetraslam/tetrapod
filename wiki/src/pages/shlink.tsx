import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Page, Reference } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;

export function ShlinkPage() {
  return (
    <Page
      title="shlink"
      intro="url shortener at link.tetraslam.world (+ .com), api-only (the container ships no web ui)."
    >
      <Doc title="create a link">
        <CodeBlock>{`KEY=$(sudo grep -oP 'INITIAL_API_KEY=\\K.*' /opt/tetrapod/shlink.env)
curl -s http://${host}:8085/rest/v3/short-urls \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"longUrl": "https://example.com/long/thing"}' | jq -r .shortUrl`}</CodeBlock>
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
              <TableCell className="text-muted-foreground">api key</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/shlink.env · health: GET /rest/health
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
