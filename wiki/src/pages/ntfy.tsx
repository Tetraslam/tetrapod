import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference } from "@/components/wiki";
import { URLS } from "@/config";

export function NtfyPage() {
  return (
    <Page
      title="ntfy"
      intro="private push notifications at ntfy.tetraslam.world, reachable anywhere and delivered directly to Android without Firebase."
    >
      <Doc title="connect Android">
        <P>
          install <Ext url="https://play.google.com/store/apps/details?id=io.heckel.ntfy">ntfy</Ext>{" "}
          from Google Play or <Ext url="https://f-droid.org/packages/io.heckel.ntfy/">F-Droid</Ext>.
          Add a subscription, choose <InlineCode>Use another server</InlineCode>, enter{" "}
          <InlineCode>{URLS.ntfy}</InlineCode>, then sign in as <InlineCode>tetraslam</InlineCode>{" "}
          with the public-services password from 1Password.
        </P>
        <P>
          self-hosted subscriptions use Android's foreground instant-delivery service. Leave it
          enabled so doze cannot delay messages; Android lets you hide its persistent notification
          without disabling the service.
        </P>
      </Doc>

      <Doc title="send a notification">
        <CodeBlock>{`curl -u 'tetraslam:<password>' \\
  -H 'Title: tetrapod' \\
  -H 'Priority: high' \\
  -d 'hello from ntfy :D' \\
  https://ntfy.tetraslam.world/test`}</CodeBlock>
        <P>
          subscribe to <InlineCode>test</InlineCode> in the app first. topic names are URLs, so use
          unguessable names for separate automations even though anonymous access is denied.
        </P>
      </Doc>

      <Doc title="agent cli">
        <CodeBlock>{`notify "plain notification"
notify --title "deploy complete" --priority high \\
  --click https://example.com/run/123 \\
  "production is healthy"
notify --file report.pdf "report ready"
notify --sequence job-42 "job started"`}</CodeBlock>
        <P>
          the <InlineCode>notify</InlineCode> CLI resolves a topic-scoped token from 1Password at
          runtime. its bundled agent skill covers Markdown, actions, attachments, delayed delivery,
          sequence updates, webhook templates, and notification etiquette.
        </P>
      </Doc>

      <Doc title="admin">
        <CodeBlock>{`docker compose -f ~/tetrapod/provision/docker-compose.yml exec ntfy ntfy user list
public-services-provision        # sync password from 1Password
curl -fsS https://ntfy.tetraslam.world/v1/health`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                binwiederhier/ntfy v2.27.0 (arm64 digest)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">access</TableCell>
              <TableCell className="text-xs">
                native login required; anonymous access denied
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">state</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/ntfy (restic-backed)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">health</TableCell>
              <TableCell className="font-mono text-xs">/v1/health (Docker + Kuma)</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
