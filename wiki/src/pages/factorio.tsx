import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference, Steps, WikiLink } from "@/components/wiki";
import { FACTORIO } from "@/config";

export function FactorioPage() {
  return (
    <Page
      title="factorio"
      intro="the server is tailnet-only: no public IP, no server browser, no griefers."
    >
      <Doc title="join">
        <Steps>
          <li>install tailscale, get invited to the tailnet (or have tetrapod shared with you)</li>
          <li>
            factorio → multiplayer → connect to address →{" "}
            <InlineCode>{FACTORIO.connectAddress}</InlineCode>
          </li>
          <li>
            if that address doesn't resolve (shared nodes don't get magicdns), use{" "}
            <InlineCode>{FACTORIO.connectAddressIp}</InlineCode>
          </li>
        </Steps>
      </Doc>

      <Doc title="admin">
        <P>rcon from a shell on the box:</P>
        <CodeBlock>{`sudo docker exec ${FACTORIO.container} rcon /players online
sudo docker exec ${FACTORIO.container} rcon "/say brb"`}</CodeBlock>
        <P>logs and restarts (check for players first — restarts kick everyone):</P>
        <CodeBlock>{`sudo docker logs ${FACTORIO.container} --tail 50
sudo docker restart ${FACTORIO.container}`}</CodeBlock>
      </Doc>

      <Doc title="saves and mods">
        <P>
          everything lives in <InlineCode>{FACTORIO.dataPath}</InlineCode> (saves, mods, server
          settings) and is covered by <WikiLink to="backups">nightly backups</WikiLink>. mods: drop
          zips in <InlineCode>{`${FACTORIO.dataPath}/mods`}</InlineCode>, restart.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">game port</TableCell>
              <TableCell className="font-mono text-xs">udp {FACTORIO.gamePort}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">rcon</TableCell>
              <TableCell className="font-mono text-xs">
                tcp {FACTORIO.rconPort} · password: {FACTORIO.rconPasswordPath}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">container</TableCell>
              <TableCell className="font-mono text-xs">{FACTORIO.container}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell className="font-mono text-xs">
                {FACTORIO.image} (arm64 via box64)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">memory cap</TableCell>
              <TableCell className="font-mono text-xs">{FACTORIO.memCap}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          box64 emulation is fine for normal factories; if a megabase tanks UPS, resize to an amd64
          instance (see <WikiLink to="runbook">runbook</WikiLink>).
        </P>
      </Reference>
    </Page>
  );
}
