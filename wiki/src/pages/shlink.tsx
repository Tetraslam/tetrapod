import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference } from "@/components/wiki";
import { HOSTS } from "@/config";

const host = HOSTS.tetrapod.name;

export function ShlinkPage() {
  return (
    <Page
      title="shlink"
      intro="url shortener. api-first — there's no web ui in the container, and honestly a curl alias is faster anyway. short domain pending, same boat as zipline."
    >
      <Doc title="create a link">
        <CodeBlock>{`KEY=$(sudo grep -oP 'INITIAL_API_KEY=\\K.*' /opt/tetrapod/shlink.env)
curl -s http://${host}:8085/rest/v3/short-urls \\
  -H "X-Api-Key: $KEY" -H "Content-Type: application/json" \\
  -d '{"longUrl": "https://example.com/very/long/thing"}' | jq -r .shortUrl`}</CodeBlock>
        <P>
          worth wrapping in a shell function once the public domain exists and links are worth
          sharing.
        </P>
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
                sqlite in /opt/tetrapod/shlink (fine at personal scale, in backups)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">api key</TableCell>
              <TableCell className="font-mono text-xs">/opt/tetrapod/shlink.env</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">health</TableCell>
              <TableCell className="font-mono text-xs">GET /rest/health</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
