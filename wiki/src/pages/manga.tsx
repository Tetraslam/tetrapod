import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference } from "@/components/wiki";
import { URLS } from "@/config";

export function MangaPage() {
  return (
    <Page
      title="manga"
      intro="suwayomi follows manga sources, downloads new chapters as CBZ archives, and serves a reader on every device."
    >
      <Doc title="read and follow">
        <P>
          open <Ext url={URLS.manga}>manga.tetraslam.world</Ext>, browse an installed source, add a
          title to the library, and mark chapters read in the web reader. library updates and new
          chapter downloads run automatically.
        </P>
      </Doc>

      <Doc title="clients and automation">
        <P>
          the bundled web UI is a PWA. external readers can use OPDS, while agents can use the
          GraphQL API directly on the tailnet:
        </P>
        <CodeBlock>{`http://tetrapod:4567/api/opds/v1.2
http://tetrapod:4567/api/graphql`}</CodeBlock>
      </Doc>

      <Doc title="seed library">
        <P>
          <InlineCode>Call of the Night (Yofukashi no Uta)</InlineCode>,{" "}
          <InlineCode>2.5 Dimensional Seduction</InlineCode>, and{" "}
          <InlineCode>My Dress-Up Darling</InlineCode> use Weeb Central. MangaDex finds all three
          but currently exposes no English chapters for them.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                suwayomi-server v2.3.2243 (pinned digest)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">extension store</TableCell>
              <TableCell className="font-mono text-xs">
                Keiyoushi · MangaDex + Weeb Central
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">downloads</TableCell>
              <TableCell className="font-mono text-xs">/srv/media/library/manga</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">state + backups</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/suwayomi · nightly restic
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">cloudflare</TableCell>
              <TableCell className="font-mono text-xs">
                shared FlareSolverr at <InlineCode>flaresolverr:8191</InlineCode>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
