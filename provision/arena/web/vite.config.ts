import { type Plugin, defineConfig } from "vite";

// `vite dev` proxies the live arena, so the UI can be worked on against real matches.
const live = process.env.ARENA_ORIGIN || "https://arena.tetraslam.world";

/**
 * ARENA_MOCK_ADMIN=1 answers /api/admin/* locally with canned data, so the control deck can be
 * built and looked at without an Authelia session. It never ships: this only exists in `vite dev`.
 */
function mockAdmin(): Plugin {
  const roster = ["openai/gpt-6.2-astra", "openai/gpt-6.1-terra", "openai/gpt-6.2-sol", "claude-agent/sonnet", "claude-agent/opus"].map(
    (id) => ({ id, provider: id.split("/")[0], ticker: id.split("/")[1], label: id, color: "#888" }),
  );
  const state = {
    config: { mode: "rotation", turnIntervalMs: 14000, autoPauseEmpty: false, pinnedModel: roster[3].id, enabledModels: roster.map((r) => r.id) },
    aiPaused: false,
    queue: [{ id: 1, model: roster[4].id, map: "Glacier", created_at: Date.now() }],
  };
  return {
    name: "mock-admin",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/admin/")) return next();
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        const send = (json: unknown) => {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(json));
        };
        if (req.url === "/api/admin/me") return send({ admin: true, user: "mock" });
        if (req.url === "/api/admin/config" && req.method === "PATCH") {
          Object.assign(state.config, body);
          if (typeof body.aiPaused === "boolean") state.aiPaused = body.aiPaused;
        }
        if (req.url === "/api/admin/action") {
          if (body.action === "pause") state.aiPaused = true;
          if (body.action === "resume") state.aiPaused = false;
        }
        if (req.url === "/api/admin/matches" && body.enqueue) state.queue.push({ id: Date.now(), model: body.model, map: body.map, created_at: Date.now() });
        const talk = req.url.match(/^\/api\/admin\/matches\/(\d+)\/interview$/);
        if (talk) {
          await new Promise((r) => setTimeout(r, 3500));
          const item = {
            id: Date.now(),
            matchId: Number(talk[1]),
            ts: Date.now(),
            asker: "mock",
            question: body.question,
            answer: "honestly the eastern belt.\n\nit fed two guns and the core at once, and when it got cut i lost all three.",
            latencyMs: 3500,
          };
          return send({ ok: true, item, interviews: [item] });
        }
        const del = req.url.match(/^\/api\/admin\/queue\/(\d+)$/);
        if (del) state.queue = state.queue.filter((q) => q.id !== Number(del[1]));
        send({
          ok: true,
          ...state,
          contender: roster[0],
          availableRoster: roster,
          roster,
          maps: ["Ancient Caldera", "Fortress", "Labyrinth", "Glacier", "Maze", "Triad"],
          usage: { total_matches: 16, total_turns: 212, total_blocks: 1840, total_prompt_chars: 1034000, total_output_chars: 96400 },
        });
      });
    },
  };
}

export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  plugins: process.env.ARENA_MOCK_ADMIN ? [mockAdmin()] : [],
  server: {
    proxy: {
      "/api": { target: live, changeOrigin: true },
      "/sprites": { target: live, changeOrigin: true },
      "/ws": { target: live, changeOrigin: true, ws: true },
    },
  },
});
