import { CodeBlock, InlineCode } from "@/components/code-block";
import { Doc, P, Page, WikiLink } from "@/components/wiki";

export function RunbookPage() {
  return (
    <Page
      title="runbook"
      intro="procedures for the rare days. everything here assumes the laptop unless noted."
    >
      <Doc title="rebuild tetrapod from scratch">
        <CodeBlock>{`cd ~/Programming/tetrapod/infra && pulumi up     # if the instance is gone
ssh tetraslam@tetrapod
git clone https://github.com/tetraslam/tetrapod && cd tetrapod
./provision/bootstrap.sh                          # idempotent, prints a summary`}</CodeBlock>
        <P>
          then the checklist bootstrap prints: croc the opa token, restic init (skip — repo exists),
          gh/gog auth, agent auth. data comes back via{" "}
          <WikiLink to="backups">restic restore</WikiLink>.
        </P>
      </Doc>

      <Doc title="resize the instance">
        <CodeBlock>{`pulumi config set tetrapod:instanceType t4g.2xlarge && pulumi up`}</CodeBlock>
        <P>
          brief stop/start; tailscale ip and all data survive. for factorio-megabase UPS problems,
          switch to an amd64 family (e.g. <InlineCode>m7a.xlarge</InlineCode>) — the factorio image
          runs natively there.
        </P>
      </Doc>

      <Doc title="break-glass (tailscale is down)">
        <P>
          aws console → EC2 → tetrapod → connect → <strong>session manager</strong> (SSM, instance
          role is pre-attached), or the serial console. or temporarily open ssh:
        </P>
        <CodeBlock>{`pulumi config set tetrapod:enablePublicSsh true && pulumi up   # revert after!`}</CodeBlock>
      </Doc>

      <Doc title="update a container image">
        <CodeBlock>{`# bump the pinned tag in provision/docker-compose.yml, then:
sudo docker compose -f ~/tetrapod/provision/docker-compose.yml up -d
git commit -am "bump <service> to <tag>"`}</CodeBlock>
      </Doc>

      <Doc title="update this wiki">
        <CodeBlock>{`# edit wiki/src (facts live in src/config.ts), then on the box:
cd ~/tetrapod/wiki && pnpm install && pnpm build   # served from dist/ immediately`}</CodeBlock>
      </Doc>

      <Doc title="restore drill (do quarterly)">
        <CodeBlock>{`sudo restic-backup restore latest --target /tmp/drill
diff -r /tmp/drill/home/tetraslam/tetrapod ~/tetrapod   # spot-check
rm -rf /tmp/drill`}</CodeBlock>
      </Doc>

      <Doc title="os updates & reboots">
        <P>
          unattended-upgrades applies security patches automatically. kernel updates need a reboot —
          do it deliberately: warn factorio players, then <InlineCode>sudo reboot</InlineCode>.
          everything (compose, tailscale serve, timers) comes back on its own.
        </P>
      </Doc>

      <Doc title="rebuild lighthouse">
        <P>
          it's stateless except kuma's data (<InlineCode>/opt/kuma</InlineCode>, not backed up —
          monitors are quick to recreate). <InlineCode>pulumi destroy --target</InlineCode> +{" "}
          <InlineCode>pulumi up</InlineCode>, or just taint it; cloud-init does the rest.
        </P>
      </Doc>
    </Page>
  );
}
