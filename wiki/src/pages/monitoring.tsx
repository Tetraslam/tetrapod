import { InlineCode } from "@/components/code-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Doc, Ext, P, Page, Reference, Steps, WikiLink } from "@/components/wiki";
import { FACTORIO, HOSTS, KUMA_API_BASE, KUMA_STATUS_SLUG, URLS } from "@/config";

// only the hand-made monitors are listed here; the 13 service monitors are
// created by provision/bin/kuma-provision and visible on the status page
const monitors = [
  { name: "tetrapod", type: "ping", target: "tetrapod" },
  { name: "factorio", type: "tcp", target: `tetrapod:${FACTORIO.rconPort} (rcon)` },
  { name: "code-server", type: "http", target: URLS.codeServer },
  { name: "restic backups", type: "push", target: "25h heartbeat from the backup script" },
  { name: "nullclaw", type: "push", target: "minutely timer (gateway is loopback-only)" },
  { name: "everything else", type: "http/tcp", target: "scripted — see below" },
];

export function MonitoringPage() {
  return (
    <Page
      title="monitoring"
      intro={
        <>
          <Ext url={URLS.kuma}>uptime-kuma</Ext> runs on lighthouse, a separate box — so it can
          report tetrapod's own death. alerts go to discord.
        </>
      }
    >
      <Doc title="add a monitor">
        <P>
          for a new service, don't click through kuma — add it to the list in{" "}
          <InlineCode>provision/bin/kuma-provision</InlineCode> and run it on the box (idempotent;
          creds via opa, status-page assignment included):
        </P>
        <Steps>
          <li>
            edit <InlineCode>HTTP_MONITORS</InlineCode> / <InlineCode>TCP_MONITORS</InlineCode> in
            the script, commit
          </li>
          <li>
            <InlineCode>~/tetrapod/provision/bin/kuma-provision</InlineCode> — new monitors land on
            the <InlineCode>{KUMA_STATUS_SLUG}</InlineCode> status page, which is what the{" "}
            <WikiLink to="home">dashboard</WikiLink> renders
          </li>
        </Steps>
        <P>
          one-off hand-made monitors still work fine (<Ext url={URLS.kuma}>open kuma</Ext>, tailnet
          hostnames resolve — use <InlineCode>tetrapod</InlineCode>, not IPs); the script won't
          touch them.
        </P>
      </Doc>

      <Doc title="the backup dead-man switch">
        <P>
          the <WikiLink to="backups">backup script</WikiLink> pings a push monitor on every success.
          its 25-hour window means one missed night = one discord page. the push url lives in{" "}
          <InlineCode>op://Agents/RESTIC_BACKUP_TETRAPOD/kuma push url</InlineCode>.
        </P>
      </Doc>

      <Doc title="who watches lighthouse">
        <P>
          nothing — deliberately. if lighthouse dies, discord goes quiet and the aws budget email is
          the backstop. watchers-for-watchers is turtles all the way down.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>monitor</TableHead>
              <TableHead>type</TableHead>
              <TableHead>target</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {monitors.map((m) => (
              <TableRow key={m.name}>
                <TableCell>{m.name}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{m.type}</TableCell>
                <TableCell className="font-mono text-xs">{m.target}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">kuma</TableCell>
              <TableCell className="font-mono text-xs">
                {URLS.kuma} (on {HOSTS.lighthouse.name}, {HOSTS.lighthouse.instance})
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">status page</TableCell>
              <TableCell className="font-mono text-xs">
                {URLS.kuma}/status/{KUMA_STATUS_SLUG}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">dashboard api</TableCell>
              <TableCell className="font-mono text-xs">
                {KUMA_API_BASE}/api/status-page/{KUMA_STATUS_SLUG} (same-origin nginx proxy — kuma
                sends no CORS headers)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
