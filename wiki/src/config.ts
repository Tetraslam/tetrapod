// Every parameterizable fact about the box lives here. Edit + rebuild.

export const TAILNET = "tailc27667.ts.net";

export const HOSTS = {
  tetrapod: {
    name: "tetrapod",
    fqdn: `tetrapod.${TAILNET}`,
    tailscaleIp: "100.79.126.72",
    instance: "t4g.xlarge",
    cpu: "4 vcpu graviton2 (arm64)",
    ram: "16 GiB (+8G zram)",
    region: "us-west-2",
    os: "ubuntu 24.04",
    disk: "200GB gp3 + 1TB st1 media (/srv/media)",
    cost: "~$150/mo (incl. disks)",
  },
  lighthouse: {
    name: "lighthouse",
    fqdn: `lighthouse.${TAILNET}`,
    instance: "t4g.micro",
    ram: "1 GiB",
    cost: "~$6.60/mo",
  },
} as const;

export const URLS = {
  codeServer: `https://${HOSTS.tetrapod.fqdn}`,
  wiki: `https://${HOSTS.tetrapod.fqdn}/wiki`,
  wikiPublic: "https://wiki.tetraslam.world", // + wiki.tetraslam.com (vercel, kuma-api rewritten to the funnel)
  kuma: `https://${HOSTS.lighthouse.fqdn}`,
  repo: "https://github.com/tetraslam/tetrapod",
} as const;

// uptime-kuma status page (create in kuma: Status Pages -> New -> slug below,
// add all monitors to it). The dashboard reads its public API through the
// same-origin nginx proxy at /kuma-api (kuma sends no CORS headers).
export const KUMA_STATUS_SLUG = "tetrapod";
export const KUMA_API_BASE = "/kuma-api";
export const KUMA_REFRESH_MS = 60_000;

export const FACTORIO = {
  connectAddress: `${HOSTS.tetrapod.fqdn}:34197`,
  connectAddressIp: `${HOSTS.tetrapod.tailscaleIp}:34197`,
  gamePort: 34197,
  rconPort: 27015,
  rconPasswordPath: "/opt/tetrapod/factorio/config/rconpw",
  dataPath: "/opt/tetrapod/factorio",
  container: "provision-factorio-1",
  memCap: "4G",
  image: "factoriotools/factorio:2.0.76",
} as const;

export const BACKUPS = {
  schedule: "10:00 UTC nightly (systemd timer)",
  repo: "s3:https://t3.storage.dev/tetraslam-backups/restic-tetrapod",
  opItem: "RESTIC_BACKUP_TETRAPOD",
  paths: ["/home/tetraslam", "/opt/tetrapod"],
  retention: "7 daily / 4 weekly / 12 monthly",
  ebsSnapshots: "daily via DLM, keep 30",
} as const;

export const OP_ITEMS = [
  { item: "FIRECRAWL_API_KEY", use: "firecrawl mcp + api" },
  { item: "OpenRouter API Key - experiments", use: "nullclaw brain (glm-5.2)" },
  { item: "NULLCLAW_DISCORD", use: "nullclaw discord bot token + owner id" },
  { item: "MORPHLLM_API_KEY", use: "morph opencode plugin (via bashrc)" },
  { item: "ANTHROPIC_API_KEY", use: "anthropic api" },
  { item: "RESTIC_BACKUP_TETRAPOD", use: "backup creds, repo, kuma push url" },
  { item: "GOG_KEYRING", use: "gog file-keyring password (gog-env)" },
  { item: "TETRAPOD_PULUMI", use: "pulumi state passphrase (laptop-side)" },
  { item: "TETRAPOD_TIGRIS", use: "tigris key for pulumi state bucket (laptop-side)" },
] as const;

export const GOG_ACCOUNTS = [
  { email: "shresht@supercomputersandfriends.com", client: "default (work)" },
  { email: "bhowmickshresht@gmail.com", client: "personal (--client personal)" },
] as const;

export const HARD_RULES = [
  "Never touch AWS Bedrock or Bedrock-related IAM — claude models run from there.",
  "Don't break tailscale. It's the only door (fallback: SSM/serial console).",
  "Don't casually restart factorio — friends play on it. Check for players first.",
  "System changes go through the repo (~/tetrapod/provision), then get applied.",
] as const;
