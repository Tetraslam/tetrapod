# tetrapod

## tetraslam's long-running, persistent aws vm for cool fun things :D

one on-demand graviton box in us-west-2, tailnet-only, everything reproducible
from this repo. also the IaC home for the rest of my aws (dbs, buckets,
whatever) — with the hard rule that we never touch bedrock or bedrock-related
IAM, since claude models run from there.

## decided

- **os:** ubuntu 24.04 LTS arm64
- **instance:** `t4g.xlarge` (4 vcpu graviton2, 16 GiB, ~$98/mo on-demand) in us-west-2
- **lighthouse:** second tiny instance, `t4g.micro` (~$6.60/mo), running uptime-kuma via cloud-init alone — watches tetrapod from outside so kuma can report tetrapod's own death. alerts via discord webhook
- **disk:** 100GB gp3 root (3000 IOPS), daily DLM snapshots, keep 30
- **iac:** pulumi + python (uv), state self-hosted on tigris (`s3://` backend, no pulumi cloud — keeps work pulumi org untouched; backend pinned in `Pulumi.yaml`)
- **secrets:** passphrase secrets provider, passphrase + everything else via 1password (`opa`, the promptless agents-vault wrapper from rice)
- **network:** tailscale with tailscale-ssh; public ingress is udp 41641 only (ssh 22 behind a pulumi flag, default off; break-glass via SSM/serial console)
- **services:** docker compose — factorio (`factoriotools/factorio`, arm64 via box64, tailnet-only, pinned tag), code-server (localhost + `tailscale serve`)
- **hermes agent:** on the host, not docker (it wants the filesystem)
- **backups:** restic → tigris nightly (ported from rice) with healthcheck ping, plus EBS snapshots
- **no watchtower:** pinned image tags, deliberate updates
- **rice subset:** bashrc/starship/helix/git config + the cli suite (eza, fd, rg, bat, fzf, zoxide, btop, jj, just, lazygit, restic, mosh, croc, gum, ...)

## layout

```
infra/       pulumi program (its own uv project)
provision/   bootstrap.sh, docker-compose.yml, dotfiles, systemd units, agent context
wiki/        home dashboard — https://tetrapod.<tailnet>.ts.net/wiki
             (vite + shadcn, live kuma status; knobs in src/config.ts)
```

## bringing it up

```bash
# one-time prep:
# 1. tigris bucket `tetrapod-pulumi-state` + a `tigris` profile in
#    ~/.aws/credentials (keys from op://Agents/TETRAPOD_TIGRIS) — used for
#    pulumi state only; the aws provider uses your default creds
# 2. passphrase in op://Agents/TETRAPOD_PULUMI/passphrase
# 3. a reusable, pre-approved, ssh-enabled tailscale auth key (both instances use it)
export PULUMI_CONFIG_PASSPHRASE="$(opa read 'op://Agents/TETRAPOD_PULUMI/passphrase')"

cd infra
uv sync
pulumi stack init prod   # backend is pinned in Pulumi.yaml, no login needed
pulumi config set aws:region us-west-2
pulumi config set tetrapod:sshPublicKey "$(cat ~/.ssh/id_ed25519.pub)"
pulumi config set tetrapod:budgetEmail bhowmickshresht@gmail.com
pulumi config set --secret tetrapod:tailscaleAuthKey tskey-auth-...
pulumi up
```

cloud-init puts both boxes on the tailnet + installs docker. lighthouse is
done at that point (kuma at `https://lighthouse.<tailnet>.ts.net`). tetrapod
needs one more step:

```bash
ssh tetraslam@tetrapod   # tailscale-ssh
git clone https://github.com/tetraslam/tetrapod && cd tetrapod
./provision/bootstrap.sh   # prints the manual-steps checklist at the end
```

manual afterwards (bootstrap prints these): croc the opa token over, create
the RESTIC_BACKUP_TETRAPOD op item + `restic-backup init`, `gh auth login`,
gog auth, and point kuma at tetrapod's services + the discord webhook.

## install list (cull me!)

derived from rice's `packages.txt` + `cli-inventory.md`, minus everything
desktop/laptop (hyprland, audio, fonts, GUI apps, asus/nvidia/wifi stack).
checked = installed by default; uncheck/delete to cull. source in parens
since ubuntu arm64 ≠ arch.

### shell & core

- [x] bash-completion, unzip, less, man-db, whois, xmlstarlet, plocate (apt)
- [x] starship (installer script)
- [x] eza (gierens apt repo)
- [x] fd, ripgrep, bat, fzf, zoxide, btop, jq, tldr (apt; `fdfind`/`batcat` symlinked to `fd`/`bat`)
- [x] dust (github binary)
- [x] gum, glow (charm apt repo)
- [x] chafa (apt)
- [x] fastfetch (apt) — server bling, your call
- [x] zellij (github binary) — configs got audited out on the laptop, but a multiplexer is more useful on a server for long-running stuff (note from shresht: this is true, but you can add back the config since it's available locally on tetrabot-2, the current machine we're on!)

### editors

- [x] helix (github binary; +config from rice)
- [ ] neovim (apt) + LazyVim — omarchy-nvim is desktop-flavored; plain LazyVim or skip since helix is the daily driver? (skip)
- [x] tree-sitter-cli (via npm/pnpm)

### vcs & dev

- [x] git, gh (apt + github apt repo)
- [x] jujutsu (github binary)
- [x] just (apt)
- [x] lazygit, lazydocker (github binaries)
- [x] difftastic (github binary)
- [x] build-essential, clang, llvm (apt)
- [ ] bpftrace (apt) — kernel spelunking, fun but heavy
- [x] typst (github binary)
- [ ] presenterm (github binary) — presentations over ssh seems unlikely

### containers

- [x] docker + buildx + compose (get.docker.com)

### net & transfer

- [x] tailscale (installer, via cloud-init)
- [x] mosh, socat, netcat-openbsd, nmap, tcpdump (apt)
- [x] croc (github binary)
- [x] bore (github binary)
- [x] bandwhich (github binary)
- [ ] syncthing (apt) — restic already covers backup; only if you want live sync with the laptop

### files & media

- [x] yazi (github binary)
- [x] imagemagick (apt)
- [x] ffmpeg (apt)
- [ ] tesseract + eng data (apt) — ocr on a server is occasionally great
- [ ] ani-cli (github) — anime on the vm?? (mpv-over-ssh is pain, but data hoarding...)

### system & monitoring

- [x] smartmontools, nvme-cli (apt)
- [x] unattended-upgrades (apt, security-only auto-patching) — new, not from rice, but a must for an always-on box
- [ ] ufw + ufw-docker — probably redundant: SG + tailnet already gate everything

### backup & secrets

- [x] restic (apt) + nightly systemd timer → tigris
- [x] 1password CLI `op` (1password apt repo, arm64) + `opa`/`opa-bootstrap` from rice

### runtimes

- [x] mise (installer; manages the rest)
- [x] node 25.x + bun via mise (matches rice mise config)
- [x] uv (installer) — all python, always
- [x] pnpm (via corepack or installer)
- [x] rustup (installer)
- [x] zig + zls via mise (in rice mise config)
- [x] go (apt/mise)
- [ ] ruby (mise)
- [ ] jdk17 (apt) — NOT needed for minecraft (itzg container ships its own java); only if you want java on the host

### agents & ai

- [x] opencode (installer)
- [x] claude-code (installer)
- [x] hermes-agent (clone + uv; install details TBD — this is the headline act)
- [ ] codex (npm)
- [ ] gemini-cli (npm)
- [ ] copilot cli (npm)

### cloud clis

- [x] aws-cli-v2 (aws installer, arm64)
- [x] pulumi (installer — project-local to this repo's workflow, separate from work login)
- [ ] gcloud (installer) — heavy; #2 in your history but is that work or personal? (it's work meow)
- [x] modal (uv tool)
- [x] vercel (npm)
- [x] gogcli (github releases ship `linux_arm64` tarballs — no brew needed; headless keyring via `GOG_KEYRING_BACKEND=file` + password from opa)

### personal tools (~/.local/bin on the laptop)

no idea which of these make sense off-laptop — mark what you want and tell me
where they live (repos? gists?):

- [x] lain (`curl -fsSL https://tetraslam.github.io/lain/install | bash` — self-contained binary, source-build fallback uses bun/pnpm which we have)
- [ ] mercury
- [ ] feynman
- [ ] rem
- [ ] whoopee (has a hardcoded laptop path in bashrc)
- [x] gog (gogcli.sh i think, it's a google workspace cli)
- [ ] blog / publish-blog

### services

- [x] factorio — `factoriotools/factorio` on tetrapod, arm64 (box64 emulation; fine for normal factories, a megabase would want an amd64 resize), udp 34197 tailnet-only, 4G memory cap
- [x] code-server on tetrapod (localhost + tailscale serve)
- [x] uptime-kuma on **lighthouse** (separate t4g.micro, cloud-init only, tailscale serve) → discord webhook alerts
- [ ] what else :D

### fable's "you're missing these" pass (not from rice)

boring plumbing an always-on headless box wants:

- [x] rsync, sqlite3, dnsutils (dig), tree, git-lfs (apt) — assumed-present basics the minimal ubuntu AMI doesn't actually ship
- [x] zram swap (zram-tools, 8G) — rice has zram-generator for a reason; minecraft's 6G heap + hermes on 16GB wants a cushion before the OOM killer picks a victim
- [x] log caps — journald `SystemMaxUse=1G` + docker `daemon.json` log rotation (`max-size=50m`). always-on boxes die of full disks more often than anything else
- [x] memory limit on the factorio container (4G cap) so a runaway save can't take out hermes
- [x] aws budget alert in pulumi (~$150/mo threshold → email). cheap insurance for "oops the IaC made three of something"
- [x] EC2 serial console + SSM as break-glass — with public 22 gone, if tailscale ever breaks you need *some* door. SSM instance profile is already planned; this is just "don't delete it later"
- [x] restic timer pings a kuma push monitor on lighthouse — backups that silently stop are worse than no backups
- [x] external "is tetrapod up" monitor — solved by lighthouse
- [x] ~~watchtower~~ no: pinned tags, deliberate updates
- [x] ~~ntfy~~ discord webhook for kuma alerts

## still to decide

- hermes-agent install details (stubbed in bootstrap)
- mercury / feynman / rem / whoopee / blog — skipped for now, revisit if missed
- what else :D
