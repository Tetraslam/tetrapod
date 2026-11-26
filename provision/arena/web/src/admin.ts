import "@ui-sdk/web/drawer";
import "@ui-sdk/web/alert-dialog";
import "@ui-sdk/web/segmented-control";
import "@ui-sdk/web/slider";
import "@ui-sdk/web/switch";
import "@ui-sdk/web/checkbox";
import "@ui-sdk/web/select";
import closeIcon from "@phosphor-icons/core/bold/x-bold.svg?raw";
import { lineLetter, tickerEl } from "./lines";
import type { AdminState, ArenaConfig, Meta, RunnerMode } from "./types";
import { $, h, num, setText } from "./util";

const SIGN_IN = "https://auth.tetraslam.world/?rd=https://arena.tetraslam.world";

/** What happens once a match is over and the queue is empty. The server calls these single, pinned and rotation. */
const AFTER: Array<{ id: RunnerMode; name: string; says: string }> = [
  {
    id: "single",
    name: "stop",
    says: "the match and anything queued play out, then the arena goes off air.",
  },
  {
    id: "pinned",
    name: "loop one",
    says: "the same model plays again on the next map, for as long as you leave it.",
  },
  { id: "rotation", name: "rotate", says: "the next model in the roster takes the next map." },
];

type Api = { open: (o?: unknown) => Promise<{ returnValue?: string }>; close: () => void };
type UiEl<T = unknown> = HTMLElement & {
  api: Api;
  value: T;
  checked: boolean;
  items: unknown;
  disabled: boolean;
};

const ui = <T = unknown>(id: string) => $(id) as UiEl<T>;

/** Give a select its options: the data on the root (for the trigger's label) and an item element for each. */
function fill(id: string, options: Array<{ value: string; label: string }>, value: string): void {
  const el = ui<string>(id);
  const key = options.map((o) => o.value).join("|");
  if (el.dataset.key !== key) {
    el.dataset.key = key;
    el.items = options;
    el.querySelector("ui-select-content")!.replaceChildren(
      ...options.map((o) => {
        const item = document.createElement("ui-select-item");
        item.setAttribute("value", o.value);
        item.className = "sel-item";
        item.textContent = o.label;
        return item;
      }),
    );
  }
  el.value = value;
}

function fmtTok(n: number | undefined): string {
  const v = Math.round(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}m`;
  if (v >= 10_000) return `${(v / 1_000).toFixed(1)}k`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}k`;
  return String(v);
}

/**
 * The control deck. It only exists for someone signed in through Authelia: everyone else
 * gets a quiet sign-in link and none of this markup.
 */
export class AdminDeck {
  on = false;
  private state: AdminState | null = null;
  private meta: Meta | null = null;
  private model = "";
  private map = "";
  private busy = false;

  constructor(
    private changed: () => void,
    private liveMatchId: () => number | null,
  ) {}

  /** Ask the protected endpoint who we are. Anonymous visitors get a redirect, which we never follow. */
  async probe(): Promise<void> {
    const link = $<HTMLAnchorElement>("adminLink");
    link.href = SIGN_IN;
    try {
      const res = await fetch("/api/admin/me", { redirect: "manual", credentials: "include" });
      if (res.status !== 200) return;
      const me = (await res.json()) as { admin?: boolean; user?: string };
      if (!me.admin) return;
      this.on = true;
      this.mount(me.user || "admin");
      await this.refresh();
      this.changed();
    } catch {
      // offline or blocked: stay a spectator
    }
  }

  setMeta(meta: Meta | null): void {
    this.meta = meta;
    if (this.on) this.renderNow();
  }

  /** The server pushed new config (someone changed it, here or in another tab). */
  onConfig(config: ArenaConfig): void {
    if (!this.on || !this.state) return;
    this.state.config = config;
    void this.refresh();
  }

  // ---------- requests ----------

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(path, {
        method,
        credentials: "include",
        redirect: "manual",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 0 || res.status === 401 || res.status === 302) {
        this.say("your sign-in ran out. sign in again and retry.", true);
        return null;
      }
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok === false) {
        this.say(String(json.error || `the arena answered ${res.status}.`).toLowerCase(), true);
        return null;
      }
      return json;
    } catch {
      this.say("couldn't reach the arena.", true);
      return null;
    }
  }

  /** Run one admin request with the deck locked, then say what happened and resync. */
  private async act(done: string, method: string, path: string, body?: unknown): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    $("deck").toggleAttribute("data-busy", true);
    const res = await this.call(method, path, body);
    if (res) {
      this.say(done);
      await this.refresh();
      this.changed();
    }
    this.busy = false;
    $("deck").toggleAttribute("data-busy", false);
    return !!res;
  }

  private say(text: string, bad = false): void {
    const el = $("deckSay");
    el.textContent = text;
    el.toggleAttribute("data-bad", bad);
  }

  async refresh(): Promise<void> {
    const res = await this.call("GET", "/api/admin/config");
    if (!res) return;
    this.state = res as unknown as AdminState;
    this.render();
  }

  private async confirm(title: string, detail: string, yes: string): Promise<boolean> {
    setText($("confirmTitle"), title);
    setText($("confirmDetail"), detail);
    setText($("confirmYes"), yes);
    const { returnValue } = await ui("confirm").api.open();
    return returnValue === "confirm";
  }

  /** Delete a finished match from the board, after asking. */
  async remove(id: number, label: string): Promise<void> {
    if (
      !(await this.confirm(
        `delete match ${id}?`,
        `${label}. its replay and feed go with it, and it can't be brought back.`,
        "delete",
      ))
    )
      return;
    await this.act(`match ${id} deleted.`, "DELETE", `/api/admin/matches/${id}`);
  }

  // ---------- markup ----------

  private mount(user: string): void {
    const host = $("adminHost");
    host.innerHTML = `
      <ui-drawer id="deckDrawer" side="right" prevent-edge-swipe>
        <ui-drawer-backdrop class="scrim" hidden></ui-drawer-backdrop>
        <ui-drawer-content class="deck-sheet" id="deck" initial-focus="content" hidden>
          <header class="deck-head">
            <div>
              <ui-drawer-title class="deck-title">control deck</ui-drawer-title>
              <ui-drawer-description class="quiet" id="deckUser"></ui-drawer-description>
            </div>
            <ui-drawer-close><button class="iconbtn" aria-label="close the control deck">${closeIcon}</button></ui-drawer-close>
          </header>
          <p class="deck-say" id="deckSay" role="status" aria-live="polite"></p>
          <div class="deck-scroll">
            <section id="secNow">
              <h3>right now</h3>
              <div id="deckNow" class="deck-now"></div>
              <div class="btnrow" id="nowActions">
                <button id="aPause" class="btn solid"></button>
                <button id="aStep" class="btn" title="take one turn now, even while paused">step one turn</button>
                <button id="aWave" class="btn" title="call the next wave in early">send wave</button>
                <button id="aIdle" class="btn danger" title="end this match and show the off-air screen">go off air</button>
              </div>
            </section>

            <section id="secAfter">
              <h3>after this match ends</h3>
              <ui-segmented-control id="cMode" aria-label="what happens after this match" class="seg seg-3">
                <ui-segmented-control-indicator class="seg-ind"></ui-segmented-control-indicator>
                ${AFTER.map((m) => `<ui-segmented-control-item value="${m.id}" class="seg-item">${m.name}</ui-segmented-control-item>`).join("")}
              </ui-segmented-control>
              <p class="hint" id="cModeSays"></p>
              <div id="cPinnedWrap" hidden>
                <ui-select id="cPinned" class="sel">
                  <ui-select-label class="lbl">the model that loops</ui-select-label>
                  <ui-select-trigger><button class="sel-btn"><ui-select-value></ui-select-value></button></ui-select-trigger>
                  <ui-select-content class="sel-list"></ui-select-content>
                </ui-select>
              </div>
              <div id="cRosterWrap" hidden>
                <span class="lbl">the roster it rotates through</span>
                <div id="cRoster" class="checks"></div>
              </div>
            </section>

            <section id="secQueue">
              <h3>up next</h3>
              <p class="hint">runs next, in order, before the after-match rule.</p>
              <ol id="lQueueList" class="queue"></ol>
            </section>

            <section id="secStart">
              <h3 id="startTitle">start a match</h3>
              <div class="pair2">
                <ui-select id="lModel" class="sel">
                  <ui-select-label class="lbl">model</ui-select-label>
                  <ui-select-trigger><button class="sel-btn"><ui-select-value></ui-select-value></button></ui-select-trigger>
                  <ui-select-content class="sel-list"></ui-select-content>
                </ui-select>
                <ui-select id="lMap" class="sel">
                  <ui-select-label class="lbl">map</ui-select-label>
                  <ui-select-trigger><button class="sel-btn"><ui-select-value></ui-select-value></button></ui-select-trigger>
                  <ui-select-content class="sel-list"></ui-select-content>
                </ui-select>
              </div>
              <div class="btnrow">
                <button id="lLaunch" class="btn solid"></button>
                <button id="lQueue" class="btn">add to queue</button>
                <button id="lSwitch" class="btn" title="hand the match in progress to this model">give it this match</button>
              </div>
            </section>

            <section id="secPace">
              <h3>pace</h3>
              <ui-slider id="cTurn" min="5" max="60" step="1" class="slider">
                <div class="slider-top"><span class="lbl">a turn every</span><b id="cTurnVal"></b></div>
                <ui-slider-control class="slider-ctl">
                  <ui-slider-track class="slider-track">
                    <ui-slider-indicator class="slider-fill"></ui-slider-indicator>
                    <ui-slider-thumb class="slider-thumb" aria-label="seconds between turns"></ui-slider-thumb>
                  </ui-slider-track>
                </ui-slider-control>
              </ui-slider>
              <label class="toggle">
                <span><b>pause when nobody's watching</b><span class="hint">after ten minutes with no spectators, the game and the ai both freeze until someone is back.</span></span>
                <ui-switch id="cEmpty" class="switch"><ui-switch-thumb class="switch-thumb"></ui-switch-thumb></ui-switch>
              </label>
            </section>

            <section>
              <h3>usage so far</h3>
              <dl id="deckUsage" class="usage"></dl>
            </section>
          </div>
        </ui-drawer-content>
      </ui-drawer>

      <ui-alert-dialog id="confirm">
        <ui-alert-dialog-backdrop class="scrim" hidden></ui-alert-dialog-backdrop>
        <ui-alert-dialog-content class="confirm" hidden>
          <ui-alert-dialog-title class="deck-title" id="confirmTitle"></ui-alert-dialog-title>
          <ui-alert-dialog-description id="confirmDetail"></ui-alert-dialog-description>
          <div class="btnrow end">
            <ui-alert-dialog-close><button class="btn">not now</button></ui-alert-dialog-close>
            <ui-alert-dialog-close value="confirm"><button class="btn danger" id="confirmYes"></button></ui-alert-dialog-close>
          </div>
        </ui-alert-dialog-content>
      </ui-alert-dialog>`;
    setText($("deckUser"), `signed in as ${user}`);

    const link = $("adminLink");
    const open = h(
      "button",
      { class: "decklink", id: "deckOpen", onclick: () => this.open() },
      "control deck",
    );
    link.replaceWith(open);

    const value = (e: Event) => (e as unknown as CustomEvent<{ value: unknown }>).detail.value;
    const patch = (done: string, body: Partial<ArenaConfig> & { aiPaused?: boolean }) =>
      void this.act(done, "PATCH", "/api/admin/config", body);

    $("aPause").addEventListener("click", () => {
      const paused = this.meta?.matchState === "paused";
      void this.act(
        paused
          ? "resumed. the game and the ai are running again."
          : "paused. the game and the ai are both frozen.",
        "POST",
        "/api/admin/action",
        { action: paused ? "resume" : "pause" },
      );
    });
    $("aStep").addEventListener(
      "click",
      () => void this.act("one turn requested.", "POST", "/api/admin/action", { action: "step" }),
    );
    $("aWave").addEventListener(
      "click",
      () =>
        void this.act("the next wave is on its way.", "POST", "/api/admin/action", { action: "send_wave" }),
    );
    $("aIdle").addEventListener("click", async () => {
      const id = this.liveMatchId();
      if (
        await this.confirm(
          "go off air?",
          `match ${id ?? ""} ends now and is scored as it stands. nothing plays until you start a match.`,
          "go off air",
        )
      )
        void this.act("off air.", "POST", "/api/admin/action", { action: "go_idle" });
    });

    $("cMode").addEventListener("valuechange", (e) => {
      const mode = String(value(e)) as RunnerMode;
      const name = AFTER.find((m) => m.id === mode)?.name;
      if (name && mode !== this.state?.config.mode) patch(`after this match: ${name}.`, { mode });
    });
    $("cPinned").addEventListener("valuechange", (e) => {
      const pinnedModel = String(value(e) || "");
      if (pinnedModel && pinnedModel !== this.state?.config.pinnedModel)
        patch(`${pinnedModel} will loop.`, { pinnedModel });
    });
    $("cTurn").addEventListener("valuechange", (e) => setText($("cTurnVal"), `${Number(value(e))}s`));
    $("cTurn").addEventListener("valuecommit", (e) => {
      const turnIntervalMs = Number(value(e)) * 1000;
      if (turnIntervalMs !== this.state?.config.turnIntervalMs)
        patch(`a turn every ${turnIntervalMs / 1000}s.`, { turnIntervalMs });
    });
    $("cEmpty").addEventListener("checkedchange", (e) => {
      const autoPauseEmpty = value(e) === true;
      if (autoPauseEmpty !== this.state?.config.autoPauseEmpty)
        patch(
          autoPauseEmpty ? "it will pause when the room is empty." : "it keeps playing to an empty room.",
          { autoPauseEmpty },
        );
    });
    $("lModel").addEventListener("valuechange", (e) => {
      this.model = String(value(e) || this.model);
    });
    $("lMap").addEventListener("valuechange", (e) => {
      this.map = String(value(e) || this.map);
    });
    $("lLaunch").addEventListener("click", async () => {
      const idle = this.meta?.matchState === "idle";
      // Off air there is nothing to interrupt, so it just starts.
      if (
        idle ||
        (await this.confirm(
          `launch ${this.model} on ${this.map}?`,
          "the match in progress ends now and is scored as it stands.",
          "launch",
        ))
      )
        void this.act(`${this.model} is dropping onto ${this.map}.`, "POST", "/api/admin/matches", {
          model: this.model,
          map: this.map,
        });
    });
    $("lQueue").addEventListener(
      "click",
      () =>
        void this.act(`queued ${this.model} on ${this.map}.`, "POST", "/api/admin/matches", {
          model: this.model,
          map: this.map,
          enqueue: true,
        }),
    );
    $("lSwitch").addEventListener(
      "click",
      () =>
        void this.act(`${this.model} has the controls.`, "POST", "/api/admin/action", {
          action: "switch_model",
          model: this.model,
        }),
    );
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const models = s.availableRoster.map((c) => ({ value: c.id, label: c.id }));
    if (!this.model || !models.some((m) => m.value === this.model)) this.model = s.contender.id;
    if (!this.map) this.map = s.maps[0] || "";

    // "paused" was once a mode. Pausing lives in "right now", so an old config reads as "stop".
    const mode: RunnerMode = s.config.mode === "paused" ? "single" : s.config.mode;
    ui<string>("cMode").value = mode;
    setText($("cModeSays"), AFTER.find((m) => m.id === mode)?.says || "");
    $("cPinnedWrap").hidden = mode !== "pinned";
    $("cRosterWrap").hidden = mode !== "rotation";
    fill(
      "cPinned",
      models.some((m) => m.value === s.config.pinnedModel)
        ? models
        : [...models, { value: s.config.pinnedModel, label: s.config.pinnedModel }],
      s.config.pinnedModel,
    );

    ui<number>("cTurn").value = Math.round(s.config.turnIntervalMs / 1000);
    setText($("cTurnVal"), `${Math.round(s.config.turnIntervalMs / 1000)}s`);
    ui("cEmpty").checked = s.config.autoPauseEmpty;

    const enabled = new Set(s.config.enabledModels);
    $("cRoster").replaceChildren(
      ...s.availableRoster.map((c) => {
        const box = document.createElement("ui-checkbox");
        box.className = "check";
        box.innerHTML = `<ui-checkbox-indicator class="check-mark" aria-hidden="true"></ui-checkbox-indicator>`;
        box.setAttribute("aria-label", c.id);
        if (enabled.has(c.id)) box.setAttribute("default-checked", "");
        box.addEventListener("checkedchange", (e) => {
          const next = new Set(this.state?.config.enabledModels || []);
          if (e.detail.value === true) next.add(c.id);
          else next.delete(c.id);
          const kept = s.availableRoster.filter((r) => next.has(r.id)).map((r) => r.id);
          if (!kept.length) {
            this.say("the roster needs at least one model.", true);
            void this.refresh();
            return;
          }
          void this.act(
            `${kept.length} model${kept.length === 1 ? "" : "s"} in rotation.`,
            "PATCH",
            "/api/admin/config",
            {
              enabledModels: kept,
            },
          );
        });
        return h("label", { class: "checkrow" }, box, tickerEl(c.id, "m"));
      }),
    );

    fill("lModel", models, this.model);
    fill(
      "lMap",
      s.maps.map((m) => ({ value: m, label: m })),
      this.map,
    );

    $("lQueueList").replaceChildren(
      ...(s.queue.length
        ? s.queue.map((q) =>
            h(
              "li",
              null,
              tickerEl(q.model, "s"),
              h("span", { class: "quiet" }, `on ${q.map}`),
              h(
                "button",
                {
                  class: "del",
                  "aria-label": `remove ${q.model} on ${q.map} from the queue`,
                  onclick: () =>
                    void this.act("removed from the queue.", "DELETE", `/api/admin/queue/${q.id}`),
                },
                "remove",
              ),
            ),
          )
        : [h("li", { class: "quiet none" }, "nothing queued. the mode above decides what plays next.")]),
    );

    this.renderUsage();
    this.renderNow();
  }

  private renderUsage(): void {
    const s = this.state;
    if (!s || !document.getElementById("deckUsage")) return;
    const u = s.usage;
    const t = this.meta?.tokens;
    const totIn = u.total_input_tokens || 0;
    const totCache = u.total_cache_read_tokens || 0;
    const totOut = u.total_output_tokens || 0;
    const allHit = totIn + totCache > 0 ? `${Math.round((100 * totCache) / (totIn + totCache))}%` : "--";
    const liveHit =
      t && t.input + t.cacheRead > 0
        ? `${t.cacheHitPct}% (${fmtTok(t.cacheRead)} / ${fmtTok(t.input + t.cacheRead)})`
        : "--";
    const row = (k: string, v: string) => h("div", null, h("dt", null, k), h("dd", null, v));
    $("deckUsage").replaceChildren(
      row("this match cache", liveHit),
      row("all-time cache hit", allHit),
      row("tokens cached", fmtTok(totCache)),
      row("tokens uncached", fmtTok(totIn)),
      row("tokens written", fmtTok(totOut)),
      row("compactions", num(u.total_compactions || 0)),
      row("matches", num(u.total_matches)),
      row("turns taken", num(u.total_turns)),
      row("blocks built", num(u.total_blocks)),
    );
  }

  open(): void {
    void ui("deckDrawer").api.open();
  }

  private renderNow(): void {
    const m = this.meta;
    const s = this.state;
    if (!s || !document.getElementById("deckNow")) return;
    const air = m?.matchState ?? (s.aiPaused ? "paused" : "live");
    const idle = air === "idle";
    const id = m?.contender.id || s.contender.id;
    const now = $("deckNow");
    const key = `${air}|${id}|${m?.matchId}|${m?.turns}|${m?.avgLatencyMs}|${m?.tokens?.cacheHitPct}|${m?.tokens?.cacheRead}|${m?.compactions}|${m?.emptyPaused}|${m?.lastCompleted?.id}`;
    if (now.dataset.key !== key) {
      now.dataset.key = key;
      const word = h("b", { class: "air", "data-air": air }, idle ? "off air" : air);
      if (idle) {
        const last = m?.lastCompleted;
        now.replaceChildren(
          word,
          h(
            "span",
            { class: "quiet" },
            last ? `no match is running. the last was match ${last.id}.` : "no match is running.",
          ),
        );
      } else {
        const tok = m?.tokens;
        const cacheNote = tok && tok.input + tok.cacheRead > 0 ? `${tok.cacheHitPct}% cache` : "";
        const compNote = m?.compactions ? `${m.compactions} compact` : "";
        const facts = [
          m?.matchId ? `match ${m.matchId}` : "",
          air === "paused" ? (m?.emptyPaused ? "nobody was watching" : "game and ai frozen") : "",
          m?.turns ? `${m.turns} turns` : "",
          m?.avgLatencyMs ? `${(m.avgLatencyMs / 1000).toFixed(1)}s a turn` : "",
          cacheNote,
          compNote,
        ].filter(Boolean);
        now.replaceChildren(word, tickerEl(id, "m"), h("span", { class: "quiet" }, facts.join(", ")));
      }
      now.title = `${lineLetter(id)} line`;
      // Off air, starting a match is the only thing to do, so that form moves to the top.
      $("nowActions").hidden = idle;
      $("lSwitch").hidden = idle;
      const start = $("secStart");
      if (idle) $("secNow").after(start);
      else $("secQueue").after(start);
      setText($("startTitle"), idle ? "start a match" : "start or queue a match");
      setText($("lLaunch"), idle ? "go on air" : "launch now");
      setText($("secAfter").querySelector("h3")!, idle ? "after a match ends" : "after this match ends");
      this.renderUsage();
    }
    setText($("aPause"), air === "paused" ? "resume" : "pause");
  }
}
