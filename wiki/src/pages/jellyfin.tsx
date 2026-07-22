import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

const URL = `http://${HOSTS.tetrapod.fqdn}:8096`;

export function JellyfinPage() {
  return (
    <Page
      title="jellyfin"
      intro="the media center. everything the pipeline downloads ends up here; tailnet-only, so it's yours and nobody else's."
    >
      <Doc title="watch">
        <P>
          <Ext url={URL}>{HOSTS.tetrapod.name}:8096</Ext> in a browser, or point any jellyfin app
          (android/ios/tv) at that address — works anywhere your device is on the tailnet.
        </P>
      </Doc>

      <Doc title="libraries">
        <P>
          three libraries, all reading from the 1TB media volume: shows and movies (fed by the{" "}
          <WikiLink to="arr">arr pipeline</WikiLink>) and youtube (fed by{" "}
          <WikiLink to="pinchflat">pinchflat</WikiLink>, added as a shows library with online
          metadata off — tvdb has opinions about vtubers).
        </P>
        <CodeBlock>{`/srv/media/library/shows    → /media/shows   (in-container)
/srv/media/library/movies   → /media/movies
/srv/media/library/youtube  → /media/youtube`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">jellyfin/jellyfin:2026072008</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">state</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/jellyfin (config + cache)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">media mount</TableCell>
              <TableCell className="font-mono text-xs">/srv/media/library (read-only)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">memory cap</TableCell>
              <TableCell className="font-mono text-xs">3G</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          no hardware transcode on graviton — clients should direct-play. if something transcodes
          and stutters, lower the client's quality setting instead of blaming the box.
        </P>
      </Reference>
    </Page>
  );
}
