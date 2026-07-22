import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

export function PinchflatPage() {
  return (
    <Page
      title="pinchflat"
      intro="youtube archiver: subscribes to channels, downloads new videos into jellyfin on a schedule."
    >
      <Doc title="add a channel">
        <P>
          <Ext url={`http://${HOSTS.tetrapod.fqdn}:8945`}>pinchflat</Ext> → sources → new source →
          paste url, pick the media profile. big channels index for hours. output lands in{" "}
          <WikiLink to="jellyfin">jellyfin</WikiLink>'s youtube library with season/episode naming.
        </P>
      </Doc>

      <Doc title="when downloads fail with 'confirm you're not a bot'">
        <P>
          youtube bot-checks aws IPs; yt-dlp needs fresh browser cookies (use a throwaway google
          account — the cookies tie it to datacenter traffic):
        </P>
        <CodeBlock>{`# laptop: export via a "get cookies.txt locally" extension, then
awk 'NR<=2 || /youtube\\.com|\\.google\\.com/' cookies.txt | \\
  ssh tetraslam@tetrapod 'cat > /opt/tetrapod/pinchflat/extras/cookies.txt'`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                ghcr.io/kieraneglin/pinchflat:v2025.6.6 (their last published tag)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">output</TableCell>
              <TableCell className="font-mono text-xs">/srv/media/library/youtube</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">cookies</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/pinchflat/extras/cookies.txt · sources use{" "}
                <InlineCode>all_operations</InlineCode>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">deno mount</TableCell>
              <TableCell className="font-mono text-xs">
                host deno → /usr/local/bin/deno (yt-dlp needs a js runtime; image predates that)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">force retries</TableCell>
              <TableCell className="font-mono text-xs">
                source page → ··· → force download
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
