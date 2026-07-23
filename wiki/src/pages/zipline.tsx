import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference } from "@/components/wiki";
import { HOSTS } from "@/config";

export function ZiplinePage() {
  return (
    <Page title="zipline" intro="screenshot and file host at i.tetraslam.world (+ .com).">
      <Doc title="upload">
        <P>
          <Ext url="https://i.tetraslam.world">i.tetraslam.world</Ext> (or tailnet-direct at{" "}
          <Ext url={`http://${HOSTS.tetrapod.fqdn}:3200`}>{HOSTS.tetrapod.name}:3200</Ext>) — first
          visit creates the admin account. for sharex/flameshot/scripts: settings → api token →{" "}
          <InlineCode>POST /api/upload</InlineCode>.
        </P>
      </Doc>

      <Doc title="cli">
        <CodeBlock>{`zipline screenshot.png
cat note.txt | zipline`}</CodeBlock>
        <P>
          the rice wrapper runs the pinned Zipline v4 client and reads its token from 1Password.
          URLs print directly for piping or pasting.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                ghcr.io/diced/zipline:v4 (only channel tags exist)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">db</TableCell>
              <TableCell className="font-mono text-xs">
                postgres:16-alpine sidecar (docker-network only)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">secret</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/zipline.env (bootstrap-generated)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">public route</TableCell>
              <TableCell className="font-mono text-xs">
                vercel host-route → funnel :10000/zip/ → share-proxy → zipline
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">uploads</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/zipline/uploads (in backups)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
