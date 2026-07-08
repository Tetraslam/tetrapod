import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS, URLS } from "@/config";

export function ConnectingPage() {
  return (
    <Page
      title="connecting"
      intro="every path onto the box. all of them require being on the tailnet."
    >
      <Doc title="shell">
        <CodeBlock>{`ssh tetraslam@tetrapod        # tailscale-ssh, no keys
mosh tetraslam@tetrapod       # survives roaming and sleep`}</CodeBlock>
        <P>
          for anything long-running, attach a zellij session first — it survives disconnects and is
          where agent sessions live:
        </P>
        <CodeBlock>{`zellij attach --create main   # detach: ctrl-g d`}</CodeBlock>
      </Doc>

      <Doc title="browser">
        <P>
          <Ext url={URLS.codeServer}>code-server</Ext> is vscode against the box's real filesystem.
          works from the ipad. this wiki lives at <InlineCode>{URLS.wiki}</InlineCode>.
        </P>
      </Doc>

      <Doc title="if tailscale is down">
        <P>
          there is no public ssh. use the break-glass paths in the{" "}
          <WikiLink to="runbook">runbook</WikiLink> (SSM session manager or the EC2 serial console).
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">hostname</TableCell>
              <TableCell className="font-mono text-xs">{HOSTS.tetrapod.fqdn}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">tailscale ip</TableCell>
              <TableCell className="font-mono text-xs">{HOSTS.tetrapod.tailscaleIp}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">user</TableCell>
              <TableCell className="font-mono text-xs">
                tetraslam (uid 1000, passwordless sudo)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">public ingress</TableCell>
              <TableCell className="font-mono text-xs">udp 41641 (wireguard) only</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
