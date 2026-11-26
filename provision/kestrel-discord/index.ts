import {
  ChannelType,
  type ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  type Message,
  Partials,
  REST,
  Routes,
  type SendableChannels,
  SlashCommandBuilder,
  type ThreadChannel,
} from "discord.js";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const OPENCODE_URL = (process.env.OPENCODE_URL || "http://127.0.0.1:4096").replace(/\/+$/, "");
const OPENCODE_PASSWORD = process.env.OPENCODE_PASSWORD || "";
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
const HEALTH_PORT = Number(process.env.HEALTH_PORT || "4097");
const STATE_DIR = process.env.KESTREL_STATE_DIR || "/opt/tetrapod/kestrel";
const STATE_FILE = join(STATE_DIR, "state.json");
const ATTACH_DIR = "/tmp/kestrel-attachments";
const MENTION_EXEMPT = new Set(
  (process.env.MENTION_EXEMPT_CHANNELS || "1475401568173162578")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const DEFAULT_MODEL = process.env.KESTREL_DEFAULT_MODEL || "claude-agent/opus";

const MODEL_CHOICES = [
  { name: "Opus 5.5 (claude-agent/opus · default)", value: "claude-agent/opus" },
  { name: "Fable 5.2 (claude-agent/fable)", value: "claude-agent/fable" },
  { name: "Sonnet 5.5 (claude-agent/sonnet)", value: "claude-agent/sonnet" },
  { name: "Haiku 5.5 (claude-agent/haiku)", value: "claude-agent/haiku" },
  { name: "GPT-6.2 Astra (openai/gpt-6.2-astra)", value: "openai/gpt-6.2-astra" },
  { name: "GPT-6.1 Terra (openai/gpt-6.1-terra)", value: "openai/gpt-6.1-terra" },
  { name: "GPT-6.2 Sol (openai/gpt-6.2-sol)", value: "openai/gpt-6.2-sol" },
];

if (!DISCORD_TOKEN) {
  console.error("kestrel-discord: DISCORD_TOKEN is required");
  process.exit(1);
}

type ChannelState = {
  sessionID: string;
  lastDeliveredMessageID?: string;
  lastSeenDiscordMessageID?: string;
  model?: string;
};

type PersistedState = {
  channels: Record<string, ChannelState>;
};

let state: PersistedState = { channels: {} };
const typingTimers = new Map<string, ReturnType<typeof setInterval>>();
const deliveryLocks = new Set<string>();
let discordReady = false;

async function loadState(): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await mkdir(ATTACH_DIR, { recursive: true });
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PersistedState;
    if (parsed && typeof parsed.channels === "object") {
      state = parsed;
    }
  } catch {
    state = { channels: {} };
  }
}

async function saveState(): Promise<void> {
  const tmp = `${STATE_FILE}.tmp.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(tmp, STATE_FILE);
}

function parseModelRef(spec: string): { providerID: string; id: string } | null {
  const idx = spec.indexOf("/");
  if (idx <= 0 || idx === spec.length - 1) return null;
  return { providerID: spec.slice(0, idx), id: spec.slice(idx + 1) };
}

async function getAuthHeader(): Promise<string | undefined> {
  if (OPENCODE_PASSWORD) {
    return "Basic " + Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString("base64");
  }
  try {
    const home = process.env.HOME || "/home/tetraslam";
    const reg = JSON.parse(await readFile(join(home, ".local/state/opencode/service.json"), "utf8"));
    if (reg?.password) {
      return "Basic " + Buffer.from(`opencode:${reg.password}`).toString("base64");
    }
  } catch {
    // ignore
  }
  return undefined;
}

async function ocFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  const auth = await getAuthHeader();
  if (auth && !headers.authorization && !headers.Authorization) {
    headers.authorization = auth;
  }
  if (init.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return await fetch(`${OPENCODE_URL}${path}`, { ...init, headers });
}

async function ocJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await ocFetch(path, init);
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`OpenCode ${init.method || "GET"} ${path} -> ${resp.status}: ${body.slice(0, 300)}`);
  }
  const text = await resp.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function createSession(channelLabel: string, modelSpec?: string): Promise<string> {
  const model = parseModelRef(modelSpec || DEFAULT_MODEL);
  const body: Record<string, unknown> = {
    title: `discord: ${channelLabel}`,
  };
  if (model) body.model = model;
  const res = await ocJson<{ data: { id: string } }>("/api/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data.id;
}

async function ensureChannelSession(channelId: string, channelLabel: string): Promise<ChannelState> {
  const existing = state.channels[channelId];
  if (existing?.sessionID) {
    try {
      await ocJson(`/api/session/${existing.sessionID}`);
      return existing;
    } catch {
      console.log(`kestrel-discord: session ${existing.sessionID} missing, creating new one for ${channelId}`);
    }
  }
  const sessionID = await createSession(channelLabel, existing?.model);
  const next: ChannelState = {
    sessionID,
    model: existing?.model || DEFAULT_MODEL,
  };
  state.channels[channelId] = next;
  await saveState();
  return next;
}

function findChannelBySession(sessionID: string): string | undefined {
  for (const [channelId, entry] of Object.entries(state.channels)) {
    if (entry.sessionID === sessionID) return channelId;
  }
  return undefined;
}

function startTyping(channelId: string, channel: SendableChannels): void {
  stopTyping(channelId);
  channel.sendTyping().catch(() => {});
  const timer = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 8000);
  typingTimers.set(channelId, timer);
  setTimeout(() => stopTyping(channelId), 10 * 60 * 1000);
}

function stopTyping(channelId: string): void {
  const timer = typingTimers.get(channelId);
  if (timer) {
    clearInterval(timer);
    typingTimers.delete(channelId);
  }
}

function chunkDiscordMessage(text: string, maxLen = 1920): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxLen) return [cleaned];

  const chunks: string[] = [];
  let remaining = cleaned;
  while (remaining.length > maxLen) {
    let split = remaining.lastIndexOf("\n\n", maxLen);
    if (split < maxLen * 0.4) split = remaining.lastIndexOf("\n", maxLen);
    if (split < maxLen * 0.4) split = remaining.lastIndexOf(" ", maxLen);
    if (split < maxLen * 0.2) split = maxLen;
    chunks.push(remaining.slice(0, split).trimEnd());
    remaining = remaining.slice(split).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

type OcMessage = {
  id: string;
  type: string;
  time?: { created?: number; completed?: number };
  content?: Array<{
    type: string;
    text?: string;
    output?: unknown;
    state?: { status?: string; output?: unknown };
  }>;
};

function extractAssistantText(msg: OcMessage): string {
  const parts: string[] = [];
  const artifactUrls = new Set<string>();
  const urlRe = /https:\/\/i\.tetraslam\.world\/a\/[A-Za-z0-9._-]+/g;

  for (const item of msg.content || []) {
    if (item.type === "text" && item.text) {
      parts.push(item.text);
    } else if (item.type === "tool") {
      const raw = JSON.stringify(item.state?.output ?? item.output ?? "");
      for (const match of raw.match(urlRe) || []) {
        artifactUrls.add(match);
      }
    }
  }

  let combined = parts.join("\n").trim();
  const missingUrls = [...artifactUrls].filter((u) => !combined.includes(u));
  if (missingUrls.length > 0) {
    combined = combined ? `${combined}\n\n${missingUrls.join("\n")}` : missingUrls.join("\n");
  }
  return combined;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

async function registerSlashCommands(): Promise<void> {
  if (!client.user) return;
  const commands = [
    new SlashCommandBuilder().setName("new").setDescription("Start a fresh OpenCode V2 session in this channel or thread"),
    new SlashCommandBuilder()
      .setName("model")
      .setDescription("Show or switch Kestrel's model for this channel/thread")
      .addStringOption((opt) =>
        opt
          .setName("model")
          .setDescription("Subscription model ticker (omit to view current)")
          .setRequired(false)
          .addChoices(...MODEL_CHOICES)
      ),
    new SlashCommandBuilder()
      .setName("thread")
      .setDescription("Create a new Discord thread with its own clean OpenCode session")
      .addStringOption((opt) =>
        opt.setName("topic").setDescription("Thread name / initial prompt").setRequired(true)
      ),
    new SlashCommandBuilder().setName("status").setDescription("Show OpenCode version, model, session ID, and MCP health"),
    new SlashCommandBuilder().setName("abort").setDescription("Interrupt Kestrel's currently running turn"),
    new SlashCommandBuilder().setName("help").setDescription("How to use Kestrel, threads, and slash commands"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  // Register globally only (works in both servers and DMs) and clear any guild-scoped duplicates
  await rest
    .put(Routes.applicationCommands(client.user.id), { body: commands })
    .then(() => console.log("kestrel-discord: registered global slash commands"))
    .catch((e) => console.error("kestrel-discord: global slash command registration failed:", e));
  for (const guild of client.guilds.cache.values()) {
    await rest
      .put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: [] })
      .catch(() => {});
  }
}

async function deliverPendingReplies(sessionID: string, errorMsg?: string): Promise<void> {
  const channelId = findChannelBySession(sessionID);
  if (!channelId) return;
  if (deliveryLocks.has(channelId)) return;
  deliveryLocks.add(channelId);

  try {
    stopTyping(channelId);
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !("send" in channel)) return;
    const sendable = channel as SendableChannels;

    const entry = state.channels[channelId];
    if (!entry || entry.sessionID !== sessionID) return;

    const res = await ocJson<{ data?: OcMessage[]; messages?: OcMessage[] } | OcMessage[]>(
      `/api/session/${sessionID}/message`
    );
    const messages: OcMessage[] = Array.isArray(res)
      ? res
      : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.messages)
          ? res.messages
          : [];

    const assistantMsgs = messages
      .filter((m) => m.type === "assistant")
      .sort((a, b) => (a.time?.created ?? 0) - (b.time?.created ?? 0));

    let startIdx = 0;
    if (entry.lastDeliveredMessageID) {
      const lastIdx = assistantMsgs.findIndex((m) => m.id === entry.lastDeliveredMessageID);
      if (lastIdx >= 0) startIdx = lastIdx + 1;
    }

    const undelivered = assistantMsgs.slice(startIdx);
    let sentAnything = false;
    let newestID = entry.lastDeliveredMessageID;

    for (const msg of undelivered) {
      const text = extractAssistantText(msg);
      if (!text) {
        newestID = msg.id;
        continue;
      }
      for (const chunk of chunkDiscordMessage(text)) {
        await sendable.send(chunk);
        sentAnything = true;
      }
      newestID = msg.id;
    }

    if (!sentAnything && errorMsg) {
      await sendable.send(`error: ${errorMsg.slice(0, 500)}`);
    }

    if (newestID && newestID !== entry.lastDeliveredMessageID) {
      entry.lastDeliveredMessageID = newestID;
      await saveState();
    }
  } catch (err) {
    console.error(`kestrel-discord: deliverPendingReplies(${sessionID}) failed:`, err);
  } finally {
    deliveryLocks.delete(channelId);
  }
}

async function startEventStream(): Promise<void> {
  while (true) {
    try {
      console.log("kestrel-discord: connecting to OpenCode SSE /api/event");
      const resp = await ocFetch("/api/event", {
        headers: { accept: "text/event-stream" },
      });
      if (!resp.ok || !resp.body) {
        throw new Error(`SSE HTTP ${resp.status}`);
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const dataLines = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim());
          if (dataLines.length === 0) continue;
          const payload = dataLines.join("\n");
          try {
            const evt = JSON.parse(payload);
            const evType = evt?.type || evt?.event || "";
            const sessionID =
              evt?.properties?.sessionID ||
              evt?.payload?.sessionID ||
              evt?.data?.sessionID ||
              evt?.sessionID;
            if (!sessionID) continue;
            if (evType === "session.execution.succeeded" || evType === "session.idle") {
              void deliverPendingReplies(sessionID);
            } else if (evType === "session.execution.failed") {
              const errMsg =
                evt?.properties?.error?.message ||
                evt?.payload?.error?.message ||
                evt?.data?.error?.message ||
                "turn failed";
              void deliverPendingReplies(sessionID, String(errMsg));
            }
          } catch {
            // ignore keepalives
          }
        }
      }
    } catch (err) {
      console.error("kestrel-discord: SSE stream error, retrying in 3s:", err);
      await Bun.sleep(3000);
    }
  }
}

async function downloadAttachments(message: Message): Promise<string[]> {
  const saved: string[] = [];
  for (const att of [...message.attachments.values()].slice(0, 4)) {
    if ((att.size || 0) > 15 * 1024 * 1024) continue;
    try {
      const resp = await fetch(att.url);
      if (!resp.ok) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      const safeName = basename(att.name || "file").replace(/[^A-Za-z0-9._-]/g, "_");
      const dest = join(ATTACH_DIR, `${message.id}-${safeName}`);
      await writeFile(dest, buf);
      saved.push(dest);
    } catch {
      // ignore
    }
  }
  return saved;
}

function shouldRespond(message: Message): boolean {
  if (message.author.bot || message.system) return false;
  if (message.channel.type === ChannelType.DM) return true;
  if (MENTION_EXEMPT.has(message.channelId)) return true;
  if (message.channel.isThread()) {
    // Once Kestrel has a session in a thread (or the thread is under #botmaxxing), reply without requiring @mention
    if (state.channels[message.channelId]) return true;
    if (message.channel.parentId && MENTION_EXEMPT.has(message.channel.parentId)) return true;
  }
  if (client.user && message.mentions.has(client.user)) return true;
  if (message.reference?.messageId && message.mentions.repliedUser?.id === client.user?.id) {
    return true;
  }
  return false;
}

async function fetchRecentHistory(message: Message, afterDiscordId?: string): Promise<string> {
  const lines: string[] = [];
  try {
    // If this is the first turn in a Discord thread, pull the starter message it branched from!
    if (!afterDiscordId && message.channel.isThread()) {
      const starter = await (message.channel as ThreadChannel).fetchStarterMessage().catch(() => null);
      if (starter && starter.id !== message.id) {
        const who = starter.author.id === client.user?.id ? "kestrel" : `@${starter.author.username}`;
        const body = (starter.content || "").replace(/\s+/g, " ").trim().slice(0, 400);
        if (body) lines.push(`[thread starter] ${who}: ${body}`);
      }
    }
    const fetched = await message.channel.messages.fetch({ limit: 15, before: message.id });
    let items = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    if (afterDiscordId) {
      const idx = items.findIndex((m) => m.id === afterDiscordId);
      if (idx >= 0) items = items.slice(idx + 1);
    }
    for (const m of items) {
      const who = m.author.id === client.user?.id ? "kestrel" : `@${m.author.username}`;
      const body = (m.content || "").replace(/\s+/g, " ").trim().slice(0, 280);
      const att = m.attachments.size > 0 ? ` [${m.attachments.size} attachment(s)]` : "";
      if (body || att) lines.push(`${who}: ${body}${att}`);
    }
  } catch {
    // ignore fetch issues
  }
  if (lines.length === 0) return "";
  return `[recent discord messages in this channel]\n${lines.join("\n")}\n[end recent history]\n`;
}

async function getStatusText(channelId: string): Promise<string> {
  const info = await ocJson<any>("/api/info");
  const mcp = await ocJson<any>("/api/mcp").catch(() => null);
  const entry = state.channels[channelId];
  const mcpList = Array.isArray(mcp?.data || mcp)
    ? (mcp?.data || mcp)
        .filter((s: any) => (s?.status?.status ?? s?.status) !== "disabled")
        .map((s: any) => `${s.name}:${s?.status?.status ?? s?.status ?? "?"}`)
        .join(", ")
    : "n/a";
  return [
    `opencode: \`${info?.version || "v2"}\` | model: \`${entry?.model || DEFAULT_MODEL}\``,
    `session: \`${entry?.sessionID || "none yet"}\``,
    `mcp: ${mcpList}`,
  ].join("\n");
}

const HELP_TEXT = [
  "`/new` — fresh opencode session for this channel/thread",
  "`/model [ticker]` — show or switch model (opus-5, fable-5-2, sonnet-5, gpt-6.2-astra, ...)",
  "`/thread <topic>` — open a dedicated Discord thread + isolated opencode session",
  "`/status` — opencode version, active model, session ID, MCPs",
  "`/abort` — interrupt current run",
  "threads: create a thread off any message and mention `@kestrel` once; kestrel reads the starter message and tracks follow-ups automatically without needing more mentions.",
].join("\n");

async function sendPromptToSession(
  channelId: string,
  channel: SendableChannels,
  entry: ChannelState,
  promptText: string
): Promise<void> {
  startTyping(channelId, channel);
  const active = await ocJson<any>("/api/session/active").catch(() => null);
  const activeList = Array.isArray(active?.data) ? active.data : Array.isArray(active) ? active : [];
  const isRunning = activeList.some((s: any) => s?.id === entry.sessionID || s?.sessionID === entry.sessionID);

  await ocJson(`/api/session/${entry.sessionID}/prompt`, {
    method: "POST",
    body: JSON.stringify({
      text: promptText,
      delivery: isRunning ? "steer" : "queue",
    }),
  });

  void ocFetch(`/api/experimental/session/${entry.sessionID}/wait`, { method: "POST" })
    .then(() => deliverPendingReplies(entry.sessionID))
    .catch(() => {});
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const cmd = interaction.commandName;
  const channelId = interaction.channelId;
  const channelLabel =
    interaction.channel?.type === ChannelType.DM
      ? `dm-${interaction.user.username}`
      : interaction.channel && "name" in interaction.channel && interaction.channel.name
        ? `#${interaction.channel.name}`
        : channelId;

  if (cmd === "help") {
    await interaction.reply({ content: HELP_TEXT, ephemeral: true });
    return;
  }

  if (cmd === "new") {
    await interaction.deferReply();
    const prevModel = state.channels[channelId]?.model || DEFAULT_MODEL;
    const sessionID = await createSession(channelLabel, prevModel);
    state.channels[channelId] = { sessionID, model: prevModel };
    await saveState();
    await interaction.editReply(`fresh session \`${sessionID}\` (\`${prevModel}\`)`);
    return;
  }

  if (cmd === "model") {
    await interaction.deferReply();
    const arg = interaction.options.getString("model");
    const entry = await ensureChannelSession(channelId, channelLabel);
    if (!arg) {
      await interaction.editReply(`current model: \`${entry.model || DEFAULT_MODEL}\` (session \`${entry.sessionID}\`)`);
      return;
    }
    const ref = parseModelRef(arg);
    if (!ref) {
      await interaction.editReply("invalid model format — expected `provider/model`");
      return;
    }
    await ocJson(`/api/session/${entry.sessionID}/model`, {
      method: "POST",
      body: JSON.stringify({ model: ref }),
    });
    entry.model = arg;
    await saveState();
    await interaction.editReply(`switched session \`${entry.sessionID}\` to \`${arg}\``);
    return;
  }

  if (cmd === "abort") {
    await interaction.deferReply();
    const entry = state.channels[channelId];
    if (!entry) {
      await interaction.editReply("no active session in this channel");
      return;
    }
    await ocJson(`/api/session/${entry.sessionID}/interrupt`, { method: "POST" });
    stopTyping(channelId);
    await interaction.editReply(`interrupted \`${entry.sessionID}\``);
    return;
  }

  if (cmd === "status") {
    await interaction.deferReply();
    await interaction.editReply(await getStatusText(channelId));
    return;
  }

  if (cmd === "thread") {
    const topic = interaction.options.getString("topic", true).trim();
    const ch = interaction.channel;
    if (!ch || !("threads" in ch) || ch.isThread()) {
      await interaction.reply({ content: "run `/thread` in a regular server text channel.", ephemeral: true });
      return;
    }
    await interaction.deferReply();
    const thread = await ch.threads.create({
      name: topic.slice(0, 90),
      autoArchiveDuration: 1440,
    });
    const sessionID = await createSession(`#${thread.name}`, DEFAULT_MODEL);
    const entry: ChannelState = { sessionID, model: DEFAULT_MODEL };
    state.channels[thread.id] = entry;
    await saveState();
    await interaction.editReply(`opened thread <#${thread.id}> (\`${sessionID}\` · \`${DEFAULT_MODEL}\`)`);
    await sendPromptToSession(
      thread.id,
      thread,
      entry,
      `[discord thread #${thread.name} | @${interaction.user.username}]: ${topic}`
    );
    return;
  }
}

async function handleBangCommand(message: Message, rawText: string): Promise<boolean> {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith("!")) return false;
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(" ").trim();
  const channelLabel =
    message.channel.type === ChannelType.DM
      ? `dm-${message.author.username}`
      : "name" in message.channel && message.channel.name
        ? `#${message.channel.name}`
        : message.channelId;

  if (cmd === "!help") {
    await message.reply(HELP_TEXT);
    return true;
  }
  if (cmd === "!new") {
    const prevModel = state.channels[message.channelId]?.model || DEFAULT_MODEL;
    const sessionID = await createSession(channelLabel, prevModel);
    state.channels[message.channelId] = { sessionID, model: prevModel };
    await saveState();
    await message.reply(`fresh session \`${sessionID}\` (\`${prevModel}\`)`);
    return true;
  }
  if (cmd === "!model") {
    const entry = await ensureChannelSession(message.channelId, channelLabel);
    if (!arg) {
      await message.reply(`current model: \`${entry.model || DEFAULT_MODEL}\` (session \`${entry.sessionID}\`)`);
      return true;
    }
    const ref = parseModelRef(arg);
    if (!ref) {
      await message.reply("usage: `!model provider/model`");
      return true;
    }
    await ocJson(`/api/session/${entry.sessionID}/model`, {
      method: "POST",
      body: JSON.stringify({ model: ref }),
    });
    entry.model = arg;
    await saveState();
    await message.reply(`switched session \`${entry.sessionID}\` to \`${arg}\``);
    return true;
  }
  if (cmd === "!abort") {
    const entry = state.channels[message.channelId];
    if (!entry) {
      await message.reply("no active session in this channel");
      return true;
    }
    await ocJson(`/api/session/${entry.sessionID}/interrupt`, { method: "POST" });
    stopTyping(message.channelId);
    await message.reply(`interrupted \`${entry.sessionID}\``);
    return true;
  }
  if (cmd === "!status") {
    await message.reply(await getStatusText(message.channelId));
    return true;
  }
  return false;
}

client.on("clientReady", () => {
  discordReady = true;
  console.log(`kestrel-discord: logged in as ${client.user?.tag}`);
  void registerSlashCommands();
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleSlashCommand(interaction);
  } catch (err: any) {
    console.error("kestrel-discord: slash command error:", err);
    const msg = `command error: ${String(err?.message || err).slice(0, 400)}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

client.on("messageCreate", async (message) => {
  if (!shouldRespond(message)) return;

  let text = message.content;
  if (client.user) {
    text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
  }

  try {
    if (await handleBangCommand(message, text)) return;

    const channelLabel =
      message.channel.type === ChannelType.DM
        ? `dm-${message.author.username}`
        : "name" in message.channel && message.channel.name
          ? `#${message.channel.name}`
          : message.channelId;

    const entry = await ensureChannelSession(message.channelId, channelLabel);
    const historyBlock = await fetchRecentHistory(message, entry.lastSeenDiscordMessageID);
    entry.lastSeenDiscordMessageID = message.id;
    await saveState();
    const attachments = await downloadAttachments(message);

    let replyQuote = "";
    if (message.reference?.messageId) {
      const refMsg = await message.fetchReference().catch(() => null);
      if (refMsg?.content) {
        replyQuote = `[replying to @${refMsg.author.username}: ${refMsg.content.slice(0, 300)}]\n`;
      }
    }

    const attachmentNote =
      attachments.length > 0
        ? `\n[attached files saved locally: ${attachments.join(", ")}]`
        : "";

    const promptText = `${historyBlock}[discord ${channelLabel} | @${message.author.username}]: ${replyQuote}${text}${attachmentNote}`.trim();
    if (!promptText) return;

    if (message.channel.isTextBased() && "sendTyping" in message.channel) {
      await sendPromptToSession(message.channelId, message.channel as SendableChannels, entry, promptText);
    }
  } catch (err: any) {
    stopTyping(message.channelId);
    console.error("kestrel-discord: message handling error:", err);
    await message.reply(`hit an error talking to opencode: ${String(err?.message || err).slice(0, 400)}`).catch(() => {});
  }
});

Bun.serve({
  hostname: "127.0.0.1",
  port: HEALTH_PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      try {
        const ocOk = (await ocFetch("/api/info")).ok;
        const ok = discordReady && ocOk;
        return new Response(
          JSON.stringify({ ok, discord: discordReady ? "ready" : "connecting", opencode: ocOk ? "ok" : "down" }),
          { status: ok ? 200 : 503, headers: { "content-type": "application/json" } }
        );
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err) }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  },
});

await loadState();
void startEventStream();
await client.login(DISCORD_TOKEN);
