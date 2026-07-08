import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference, WikiLink } from "@/components/wiki";
import { BACKUPS } from "@/config";

export function BackupsPage() {
  return (
    <Page
      title="backups"
      intro="restic to tigris, nightly. every successful run pings a kuma push monitor — a missed night pages discord."
    >
      <Doc title="restore">
        <CodeBlock>{`sudo restic-backup snapshots                              # list
sudo restic-backup restore latest --target /tmp/restore   # full
sudo restic-backup restore latest --target /tmp/r --include /home/tetraslam/some/file`}</CodeBlock>
        <P>
          do a restore drill occasionally — backups you've never restored are schrödinger's backups.
          procedure in the <WikiLink to="runbook">runbook</WikiLink>.
        </P>
      </Doc>

      <Doc title="run and verify">
        <CodeBlock>{`sudo restic-backup          # run one now
sudo restic-backup check    # repo integrity`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">schedule</TableCell>
              <TableCell className="text-xs">{BACKUPS.schedule}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">paths</TableCell>
              <TableCell className="font-mono text-xs">{BACKUPS.paths.join("  ·  ")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">repo</TableCell>
              <TableCell className="font-mono text-xs">{BACKUPS.repo}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">retention</TableCell>
              <TableCell className="text-xs">{BACKUPS.retention}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">credentials</TableCell>
              <TableCell className="font-mono text-xs">
                op://Agents/{BACKUPS.opItem} (via opa)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">ebs snapshots</TableCell>
              <TableCell className="text-xs">{BACKUPS.ebsSnapshots}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          implementation: <InlineCode>/usr/local/bin/restic-backup</InlineCode> +{" "}
          <InlineCode>restic-backup.timer</InlineCode> (systemd), source in{" "}
          <InlineCode>provision/</InlineCode>. secrets resolve at runtime via{" "}
          <WikiLink to="secrets">opa</WikiLink>.
        </P>
      </Reference>
    </Page>
  );
}
