import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

const JELLYFIN_URL = `http://${HOSTS.tetrapod.fqdn}:8096`;

export function JellyfinPage() {
  return (
    <Page title="jellyfin" intro="the media center. everything the pipeline downloads lands here.">
      <Doc title="watch">
        <P>
          <Ext url={JELLYFIN_URL}>{HOSTS.tetrapod.name}:8096</Ext> — browser or any jellyfin app on
          the tailnet. no hardware transcode on graviton: if playback stutters, lower the client
          quality (direct play is fine).
        </P>
      </Doc>

      <Doc title="libraries">
        <CodeBlock>{`shows    ← arr pipeline      /srv/media/library/shows
movies   ← arr pipeline      /srv/media/library/movies
youtube  ← pinchflat         /srv/media/library/youtube`}</CodeBlock>
        <P>
          youtube is a shows library with internet metadata <em>off</em> — tvdb mismatches youtube
          content (it once matched a livestream diary to a 1950s variety show).
        </P>
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
              <TableCell className="font-mono text-xs">/opt/tetrapod/jellyfin</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">media mount</TableCell>
              <TableCell className="font-mono text-xs">
                /srv/media/library (ro) · mem cap 3G
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">feeds</TableCell>
              <TableCell className="font-mono text-xs">
                <WikiLink to="arr">arr pipeline</WikiLink> ·{" "}
                <WikiLink to="pinchflat">pinchflat</WikiLink>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
