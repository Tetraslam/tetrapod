import { CodeBlock, InlineCode } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference, WikiLink } from "@/components/wiki";
import { HOSTS } from "@/config";

export function InfraPage() {
  return (
    <Page
      title="infra"
      intro="both boxes and everything around them are pulumi (python/uv) in infra/. state is self-hosted on tigris — no pulumi cloud, the work org can't be touched."
    >
      <Doc title="make a change">
        <P>run from the laptop (state passphrase + tigris profile live there):</P>
        <CodeBlock>{`export PULUMI_CONFIG_PASSPHRASE="$(opa read 'op://Agents/TETRAPOD_PULUMI/passphrase')"
cd ~/Programming/tetrapod/infra
pulumi preview        # always
pulumi up`}</CodeBlock>
      </Doc>

      <Doc title="what's declared">
        <P>
          tetrapod ({HOSTS.tetrapod.instance}, termination-protected, {HOSTS.tetrapod.disk}),
          lighthouse ({HOSTS.lighthouse.instance}, kuma via cloud-init), the tailnet-only security
          group, SSM break-glass role, daily EBS snapshots (DLM, keep 30), and a $150/mo budget
          alert. lighthouse has no bootstrap — to change it, change its cloud-init in{" "}
          <InlineCode>infra/__main__.py</InlineCode> (see <WikiLink to="runbook">runbook</WikiLink>{" "}
          for rebuild).
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">stack</TableCell>
              <TableCell className="font-mono text-xs">
                prod (backend pinned in Pulumi.yaml → tigris s3)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">state bucket</TableCell>
              <TableCell className="font-mono text-xs">
                tetrapod-pulumi-state (tigris, `tigris` aws profile)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">config keys</TableCell>
              <TableCell className="font-mono text-xs">
                instanceType · lighthouseType · rootVolumeGb · sshPublicKey · tailscaleAuthKey
                (secret) · budgetEmail · budgetLimit · enablePublicSsh
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">cost</TableCell>
              <TableCell className="font-mono text-xs">
                tetrapod {HOSTS.tetrapod.cost} · lighthouse {HOSTS.lighthouse.cost} · budget alarm
                at $150
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">forbidden</TableCell>
              <TableCell className="font-mono text-xs">
                anything bedrock — see <WikiLink to="rules">rules</WikiLink>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
