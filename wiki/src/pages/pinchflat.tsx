import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, Steps, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

export function PinchflatPage() {
  return (
    <Page
      title="pinchflat"
      intro="youtube archiver. subscribe to channels, it downloads everything into the jellyfin youtube library on a schedule. youtube deletes things; we don't."
    >
      <Doc title="add a channel">
        <Steps>
          <li>
            <Ext url={`http://${HOSTS.tetrapod.fqdn}:8945`}>pinchflat</Ext> → sources → new source
          </li>
          <li>paste the channel or playlist url, pick the media profile, save</li>
          <li>indexing a big channel takes hours — that's normal, walk away</li>
        </Steps>
        <P>
          output lands in <InlineCode>/srv/media/library/youtube</InlineCode> with season/episode
          naming, which is why <WikiLink to="jellyfin">jellyfin</WikiLink> reads it as a shows
          library.
        </P>
      </Doc>

      <Doc title="youtube vs datacenter IPs">
        <P>
          youtube bot-checks aws addresses, so yt-dlp needs real browser cookies. they live at{" "}
          <InlineCode>/opt/tetrapod/pinchflat/extras/cookies.txt</InlineCode> (netscape format,
          youtube/google lines only), and each source's cookie behaviour is set to{" "}
          <InlineCode>all_operations</InlineCode>. refresh when downloads start failing with "sign
          in to confirm you're not a bot":
        </P>
        <CodeBlock>{`# on the laptop: export via a "get cookies.txt locally" extension, then
awk 'NR<=2 || /youtube\\.com|\\.google\\.com/' cookies.txt | \\
  ssh tetraslam@tetrapod 'cat > /opt/tetrapod/pinchflat/extras/cookies.txt'`}</CodeBlock>
        <P>
          prefer a throwaway google account — the cookies tie whatever account exported them to
          yt-dlp traffic from an aws IP.
        </P>
      </Doc>

      <Doc title="the deno mount">
        <P>
          modern yt-dlp wants a js runtime for youtube extraction; the pinned image predates that,
          so the host's deno binary is mounted in at <InlineCode>/usr/local/bin/deno</InlineCode>.
          if formats go missing again, check that mount before anything else.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                ghcr.io/kieraneglin/pinchflat:v2025.6.6 (last tag they published)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">state</TableCell>
              <TableCell className="font-mono text-xs">/opt/tetrapod/pinchflat</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">output</TableCell>
              <TableCell className="font-mono text-xs">/srv/media/library/youtube</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">force retries</TableCell>
              <TableCell className="font-mono text-xs">
                source page → ··· → force download (or enqueue oban jobs, see git log)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
