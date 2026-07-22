import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference, Steps } from "@/components/wiki";
import { HOSTS } from "@/config";

export function MindustryPage() {
  return (
    <Page title="mindustry" intro="game server, tailnet-only — same access model as factorio.">
      <Doc title="join">
        <Steps>
          <li>mindustry → play → + server → add server</li>
          <li>
            <InlineCode>{`${HOSTS.tetrapod.fqdn}:6567`}</InlineCode> (or{" "}
            <InlineCode>{`${HOSTS.tetrapod.tailscaleIp}:6567`}</InlineCode> for shared nodes without
            magicdns)
          </li>
        </Steps>
      </Doc>

      <Doc title="admin">
        <P>the server wants a console, so it runs with a tty — attach for commands:</P>
        <CodeBlock>{`sudo docker attach provision-mindustry-1   # detach: ctrl-p ctrl-q (NOT ctrl-c)
# console: help, maps, host <map> <mode>, kick <player>, pause`}</CodeBlock>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">ports</TableCell>
              <TableCell className="font-mono text-xs">tcp+udp 6567 (tailnet via SG)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">server jar</TableCell>
              <TableCell className="font-mono text-xs">
                v159.7 at /opt/tetrapod/mindustry/server.jar (temurin 17 jre image)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">update</TableCell>
              <TableCell className="font-mono text-xs">
                bump version in bootstrap.sh, delete the jar, re-run bootstrap
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">data</TableCell>
              <TableCell className="font-mono text-xs">
                /opt/tetrapod/mindustry (maps, saves — in nightly backups)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
