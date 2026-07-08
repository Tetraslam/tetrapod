import {
  Bot,
  Cloud,
  Database,
  Factory,
  KeyRound,
  type LucideIcon,
  Server,
  Siren,
  TerminalSquare,
} from "lucide-react";
import type { ReactNode } from "react";
import { CodeBlock, InlineCode } from "@/components/code-block";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BACKUPS,
  FACTORIO,
  GOG_ACCOUNTS,
  HARD_RULES,
  HOSTS,
  OP_ITEMS,
  TAILNET,
  URLS,
} from "@/config";

export type Section = {
  id: string;
  title: string;
  icon: LucideIcon;
  body: ReactNode;
};

const P = ({ children }: { children: ReactNode }) => (
  <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>
);

export const sections: Section[] = [
  {
    id: "overview",
    title: "overview",
    icon: Server,
    body: (
      <div className="space-y-4">
        <P>
          tetrapod is the always-on AWS box: {HOSTS.tetrapod.instance}, {HOSTS.tetrapod.os},{" "}
          {HOSTS.tetrapod.region}, {HOSTS.tetrapod.cost}. tailnet-only (no public ports except
          wireguard), everything reproducible from{" "}
          <a className="underline" href={URLS.repo}>
            the repo
          </a>
          . its sibling <InlineCode>lighthouse</InlineCode> ({HOSTS.lighthouse.instance},{" "}
          {HOSTS.lighthouse.cost}) watches it from outside.
        </P>
        <Alert variant="destructive">
          <Siren className="size-4" />
          <AlertTitle>hard rules</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {HARD_RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      </div>
    ),
  },
  {
    id: "connect",
    title: "connecting",
    icon: TerminalSquare,
    body: (
      <div className="space-y-4">
        <CodeBlock>{`ssh tetraslam@tetrapod        # tailscale-ssh, no keys needed
mosh tetraslam@tetrapod       # survives roaming/sleep
zellij attach --create main   # persistent sessions (detach: ctrl-g d)`}</CodeBlock>
        <P>
          code-server (vscode in the browser):{" "}
          <a className="underline" href={URLS.codeServer}>
            {URLS.codeServer}
          </a>
          . works on the ipad too — anything on the tailnet.
        </P>
        <P>
          break-glass if tailscale is ever broken: AWS console → EC2 → connect → session manager
          (SSM), or the serial console. public ssh is off by default (pulumi flag{" "}
          <InlineCode>enablePublicSsh</InlineCode>).
        </P>
      </div>
    ),
  },
  {
    id: "factorio",
    title: "factorio",
    icon: Factory,
    body: (
      <div className="space-y-4">
        <P>the factory must grow. friends join in three steps:</P>
        <ol className="list-decimal space-y-1 pl-5 text-muted-foreground text-sm">
          <li>
            they install tailscale, you share tetrapod with them (admin console → machines →
            tetrapod → share) or invite them to the tailnet
          </li>
          <li>factorio → multiplayer → connect to address:</li>
        </ol>
        <CodeBlock>{`${FACTORIO.connectAddress}
${FACTORIO.connectAddressIp}   # if magicdns doesn't resolve for them (shared nodes)`}</CodeBlock>
        <P>server admin from the box:</P>
        <CodeBlock>{`sudo docker exec ${FACTORIO.container} rcon /players online
sudo docker exec ${FACTORIO.container} rcon "/say brb restarting"
sudo docker restart ${FACTORIO.container}          # only when it's empty!
sudo docker logs ${FACTORIO.container} --tail 50`}</CodeBlock>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">game port</TableCell>
              <TableCell>udp {FACTORIO.gamePort} (tailnet-only)</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">rcon</TableCell>
              <TableCell>
                tcp {FACTORIO.rconPort}, password at{" "}
                <InlineCode>{FACTORIO.rconPasswordPath}</InlineCode>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">saves & mods</TableCell>
              <TableCell>
                <InlineCode>{FACTORIO.dataPath}</InlineCode> (in nightly backups)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">image</TableCell>
              <TableCell>
                <InlineCode>{FACTORIO.image}</InlineCode> — arm64 via box64, {FACTORIO.memCap} mem
                cap. megabase UPS problems → resize to amd64.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    ),
  },
  {
    id: "services",
    title: "services",
    icon: Cloud,
    body: (
      <div className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>service</TableHead>
              <TableHead>where</TableHead>
              <TableHead>notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>factorio</TableCell>
              <TableCell>
                <InlineCode>{FACTORIO.connectAddress}</InlineCode>
              </TableCell>
              <TableCell className="text-muted-foreground">docker compose, tailnet-only</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>code-server</TableCell>
              <TableCell>
                <a className="underline" href={URLS.codeServer}>
                  {HOSTS.tetrapod.fqdn}
                </a>
              </TableCell>
              <TableCell className="text-muted-foreground">tailscale serve → :8443</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>this wiki</TableCell>
              <TableCell>
                <InlineCode>{URLS.wiki}</InlineCode>
              </TableCell>
              <TableCell className="text-muted-foreground">
                static dist via tailscale serve path mount
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>uptime-kuma</TableCell>
              <TableCell>
                <a className="underline" href={URLS.kuma}>
                  {HOSTS.lighthouse.fqdn}
                </a>
              </TableCell>
              <TableCell className="text-muted-foreground">
                on lighthouse (separate box) → discord alerts
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          services are docker compose in{" "}
          <InlineCode>~/tetrapod/provision/docker-compose.yml</InlineCode>. change there, then{" "}
          <InlineCode>sudo docker compose -f ... up -d</InlineCode>, then commit. image tags stay
          pinned — no watchtower, updates are deliberate.
        </P>
      </div>
    ),
  },
  {
    id: "backups",
    title: "backups",
    icon: Database,
    body: (
      <div className="space-y-4">
        <P>
          restic → tigris, {BACKUPS.schedule}. backs up{" "}
          {BACKUPS.paths.map((p, i) => (
            <span key={p}>
              {i > 0 && " + "}
              <InlineCode>{p}</InlineCode>
            </span>
          ))}
          , retention {BACKUPS.retention}. every success pings the kuma push monitor — a missed
          night pages discord. plus EBS snapshots ({BACKUPS.ebsSnapshots}).
        </P>
        <CodeBlock>{`sudo restic-backup snapshots               # list
sudo restic-backup                         # run one now
sudo restic-backup restore latest --target /tmp/drill   # restore drill
sudo restic-backup check                   # repo integrity`}</CodeBlock>
        <P>
          creds live in <InlineCode>{`op://Agents/${BACKUPS.opItem}`}</InlineCode>; repo is{" "}
          <InlineCode>{BACKUPS.repo}</InlineCode>.
        </P>
      </div>
    ),
  },
  {
    id: "secrets",
    title: "secrets",
    icon: KeyRound,
    body: (
      <div className="space-y-4">
        <P>
          the only 1password access here is <InlineCode>opa</InlineCode> — a read-only service
          account scoped to the Agents vault (token at{" "}
          <InlineCode>~/.config/op/agents-token</InlineCode>). no desktop app, no personal vault.
        </P>
        <CodeBlock>{`opa read "op://Agents/<item>/credential"
opa item list --vault Agents`}</CodeBlock>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>item</TableHead>
              <TableHead>used for</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {OP_ITEMS.map((i) => (
              <TableRow key={i.item}>
                <TableCell className="font-mono text-xs">{i.item}</TableCell>
                <TableCell className="text-muted-foreground">{i.use}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    ),
  },
  {
    id: "agents",
    title: "agents & ai",
    icon: Bot,
    body: (
      <div className="space-y-4">
        <P>
          opencode + claude code are installed with full user context:{" "}
          <InlineCode>~/.config/opencode/AGENTS.md</InlineCode> and{" "}
          <InlineCode>~/.claude/CLAUDE.md</InlineCode> symlink to the repo, memory syncs from rice
          via <InlineCode>provision/setup-agents.sh</InlineCode> (idempotent, re-run to refresh).
        </P>
        <CodeBlock>{`zellij attach --create agents   # persistent agent sessions
clod                            # claude, yolo mode
opencode                        # opencode`}</CodeBlock>
        <P>
          gog (google workspace cli) has two accounts:{" "}
          {GOG_ACCOUNTS.map((a, i) => (
            <span key={a.email}>
              {i > 0 && ", "}
              <InlineCode>{a.email}</InlineCode> ({a.client})
            </span>
          ))}
          . run <InlineCode>gog-env</InlineCode> first (keyring password via opa).
        </P>
        <P>
          hermes-agent: not installed yet — the stub in bootstrap.sh is waiting.{" "}
          <Badge variant="outline">someday</Badge>
        </P>
      </div>
    ),
  },
  {
    id: "infra",
    title: "infra & runbook",
    icon: Cloud,
    body: (
      <div className="space-y-4">
        <P>
          everything is pulumi (python/uv) in <InlineCode>~/tetrapod/infra</InlineCode>, state
          self-hosted on tigris. run from the laptop:
        </P>
        <CodeBlock>{`export PULUMI_CONFIG_PASSPHRASE="$(opa read 'op://Agents/TETRAPOD_PULUMI/passphrase')"
cd ~/Programming/tetrapod/infra
pulumi preview   # always preview first
pulumi up`}</CodeBlock>
        <P>common ops:</P>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">resize instance</TableCell>
              <TableCell>
                <InlineCode>pulumi config set tetrapod:instanceType t4g.2xlarge</InlineCode> +{" "}
                <InlineCode>pulumi up</InlineCode> (brief stop/start)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">rebuild from scratch</TableCell>
              <TableCell>
                pulumi up → ssh in → clone repo → <InlineCode>provision/bootstrap.sh</InlineCode>{" "}
                (idempotent, prints a summary + checklist)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">update this wiki</TableCell>
              <TableCell>
                edit <InlineCode>wiki/src</InlineCode> (config in{" "}
                <InlineCode>src/config.ts</InlineCode>) → <InlineCode>pnpm build</InlineCode> on the
                box → served automatically
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">os updates</TableCell>
              <TableCell>
                unattended-upgrades handles security patches; kernel reboots are manual + deliberate
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          tailnet: <InlineCode>{TAILNET}</InlineCode>. budget alarm emails at $150/mo. DLM snapshots
          + termination protection on the instance.
        </P>
      </div>
    ),
  },
];
