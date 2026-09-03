# Nullclaw hardening, 2026-09-01

This is an append-only engineering record. Do not revise the contract or earlier
entries to match later conclusions. Append corrections with evidence.

## Immutable contract

Source session: `ses_fa58322a0ffeNrDY34jla31SYT` (`happy-cactus`).
Contract frozen at 2026-08-31 23:58 PDT.

- Work continuously through 2026-09-01 11:30 PDT. Do not stop at the literal
  examples; extrapolate into adjacent Nullclaw behavior that affects normal use.
- Switch the deployed model to `openai/gpt-5.6-terra`.
- Images sent through Discord must reach the model as actual image data, in the
  same turn and in order. Never invite or accept a visual description when no
  image reached the model.
- Other Discord attachments must be downloaded to durable, controlled workspace
  storage and represented to the model with truthful filename, type, size, and
  absolute path. The host shell is the general consumer for formats without a
  native provider representation.
- Test how Shresht actually uses the bot: real Discord-shaped gateway payloads,
  concurrent messages, attachment-only messages, multiple files, provider tool
  calls, persistence, restart/hydration, and live Discord delivery.
- Preserve behavior that is already correct. Prefer the smallest complete fix;
  do not spend time on speculative abstractions or ceremonial iteration.
- Continue into queues, persistence, attachment lifecycle, provider
  serialization, error truthfulness, observability, restart recovery, and other
  reproduced jank. A passing narrow unit test is not the end state.
- Keep `agent.max_history_messages` unchanged.
- Preserve the customized fork carefully and pin every deployed source commit.

The last four user directives were read directly from the OpenCode database.
Their operative language was:

1. `2026-08-31 22:51 PDT`: make host access "seamless and simple"; do not change
   max history; preserve non-target memories; rebase and pin extremely carefully.
2. `2026-08-31 22:53 PDT`: continue when the next steps are known.
3. `2026-08-31 23:52 PDT`: switch to Terra; fix images seamlessly; store other
   attachments in the workspace; investigate the harness end to end; test
   rigorously according to real use; extrapolate beyond the named examples.
4. `2026-08-31 23:55 PDT`: continue until 11:30 AM PDT and keep extrapolating
   rather than constraining work to the precise examples.

## System boundary

- Atomic ingress unit: one Discord `MESSAGE_CREATE`, including its complete
  attachment array and Discord message ID.
- Ordering unit: all accepted messages for one canonical Discord session.
- Code authority: pinned commits in `Tetraslam/nullclaw`.
- Deployment/config authority: `Tetraslam/tetrapod` provisioning plus systemd.
- Durable attachment authority: a controlled directory under Nullclaw's
  workspace, owned by the `tetraslam` service user.
- Conversation authority: SQLite session history plus explicit attachment
  receipts; volatile local paths are not durable state.
- Trusted inputs: Discord gateway fields after type/size validation and HTTPS
  attachment URLs supplied by Discord.
- Lifecycle owner: Discord ingress creates attachment artifacts; session/history
  retention owns them after publication. Failed publication must clean them up.
- Critical evidence: payload-faithful tests, full ARM suite, real provider image
  request, real host tool call, restart recovery, and live Discord messages.

## Acceptance matrix

- PNG, JPEG, GIF, WebP, BMP: downloaded, magic-validated, and sent as image data.
- Image content-type/extension mismatch: classified by bytes, with mismatch
  recorded; never silently treated as a valid image from metadata alone.
- Transparent or 1x1 valid image: delivered as the actual image, not rejected or
  described from text. The model may truthfully report that it is blank.
- PDF, text, JSON, CSV, audio, video, archives, and unknown binaries: stored with
  sanitized original filename and a model-visible receipt/path. No false image
  marker.
- Attachment-only and multi-attachment messages: accepted and ordered.
- Second message during a long first turn: queued without replacement or loss.
- Download failure, redirect, oversize, disk failure, and malformed payload:
  explicit bounded receipt plus logs keyed by Discord message/attachment ID.
- Restart/hydration: attachment receipt and durable path remain valid.
- Provider error: user turn and assistant failure marker remain persisted.
- Model/tool behavior: Terra receives images, can inspect stored files through
  host shell, and Discord returns the final response.

## Append log

### 2026-09-01 00:00 PDT, initial evidence

- OpenRouter reports `openai/gpt-5.6-terra` available with 1,050,000 context,
  `text`, `image`, and `file` input, text output, and tool support.
- Pictured first image turn persisted at `2026-09-01 06:38:46 UTC` with
  `[IMAGE:/tmp/discord_cd03af3ad3d893ae.dat]`.
- Pictured second message persisted at `2026-09-01 06:40:22 UTC` with text only.
  No attachment marker reached session persistence.
- Existing Discord ingress downloads every attachment through a 4 MiB helper,
  writes anonymous `/tmp/discord_<random>.dat`, and labels every format
  `[IMAGE:]`.
- Download, file creation, file write, and content-buffer failures are silent or
  log-only. No failure receipt reaches the model or user.
- Discord REST hydration ignores attachments and drops attachment-only messages.
- The deployment currently uses queue mode `latest`; this can replace a pending
  second message and is not acceptable for attachment fidelity.
- Existing provider URL-image smoke tests do not exercise Discord download,
  durable storage, queueing, or persistence. They did not validate the pictured
  path.

### 2026-09-01 09:48 PDT, attachment implementation evidence

- Customized fork commit `e4885c9d819bf271b36f3d63d267d21d254cc9b6`
  implements typed Discord attachment parsing and deterministic storage under
  `<workspace>/attachments/discord/<channel>/<message>/`.
- Downloads are limited to ten Discord attachments per message and 50 MiB per
  attachment. Curl redirects are disabled; bytes stream into an exclusive file
  opened relative to no-follow directory handles. Partial, oversize, malformed,
  path, and publication failures produce model-visible receipts and keyed logs.
- Magic bytes, not extension or Discord content type, select image handling.
  Local images are capped at exactly 25 MiB and up to ten images remain ordered
  in one provider request. Other files retain truthful durable paths for host
  tools.
- Attachment directories use two lifecycle markers. `.ready` means every file
  and receipt is complete; `.published` is committed only after the inbound bus
  accepts the message. Published directories are immutable on replay. Complete
  `.ready` directories are reused and recommitted; incomplete unmarked
  directories are rebuilt. Failed publication and no-bus paths clean newly
  created directories.
- Discord REST hydration now retains attachment-only messages and reconstructs
  receipts only from `.published` storage. Malformed attachment-only history is
  retained with an explicit failure receipt.
- A real 7,126,536-byte Discord-shaped PNG fixture traversed gateway ingestion,
  durable storage, multimodal base64 conversion, and OpenRouter JSON
  serialization. Mixed PNG, JPEG, WebP, GIF, BMP, and PDF fixtures preserved
  order and produced five image parts plus one file receipt.
- Exact-boundary evidence: a 25 MiB PNG is accepted and 25 MiB plus one byte is
  rejected. This exposed and fixed an EOF-probe off-by-one in the bounded image
  reader.
- `zig build test -Dtarget=x86_64-linux-musl --summary all`: 7,428 passed, 14
  skipped. `zig build -Doptimize=ReleaseSmall --summary all`: 9/9 steps passed.
  Formatting and `git diff --check` passed. Native debug tests remain blocked by
  the host GCC 16 `.sframe`/`R_X86_64_PC64` linker incompatibility.
- Unproven boundary: filesystem directory metadata and Nullclaw's in-memory bus
  cannot share one transaction. A process crash after bus acceptance but before
  `.published` rename leaves complete `.ready` files. They are preserved and
  recommitted on Discord replay, but crash durability of directory entries is
  not proven because Zig exposes no directory fsync in this compatibility layer.

### 2026-09-01 01:50 PDT, first live Discord finding

- The first deployment used fork commit `e4885c9d819bf271b36f3d63d267d21d254cc9b6`.
  Terra returned the exact text nonce `terra-text-e4885c9d` through Discord.
- A mixed live message carried a 7,756,289-byte JPEG and a 222-byte JSON file.
  The JPEG downloaded byte-for-byte to deterministic published storage, proving
  the old 4 MiB transport cap was removed. The JSON exposed a payload variant
  absent from fixtures: Discord gateway ID `[CARD_1]`, while Discord REST
  canonicalized the same attachment to snowflake `1544267611678974062`.
- Discord also supplied the standard parameterized MIME value
  `application/json; charset=utf-8`; the initial parser rejected its semicolon
  because receipt delimiters and metadata validation were coupled.
- Fork commit `73bfd77069a5a37d4233180078053c6b8d4d212d` derives only synthetic gateway
  IDs from validated Discord CDN paths, requiring numeric channel/attachment
  segments and a filename. It accepts control-free MIME parameters while
  escaping receipt delimiters before model exposure.
- Post-fix verification: 7,430 passed, 14 skipped on x86_64-musl; ReleaseSmall
  build 9/9; formatting and diff checks passed.

### 2026-09-01 02:05 PDT, second live Discord finding

- Fork `73bfd77069a5a37d4233180078053c6b8d4d212d` stored both retry attachments:
  JPEG 7,756,289 bytes and JSON 222 bytes. Terra used the exact durable JSON
  path through the host shell and returned nonce `terra-attachment-e4885c9d`.
- The same JPEG sent directly to OpenRouter model `openai/gpt-5.6-terra` returned
  HTTP 200 and correctly described people jumping beneath leafy trees. Provider
  vision at this size is therefore proven independently of Nullclaw.
- Under Nullclaw's tool-heavy prompt, Terra chose `image_info`. That metadata
  tool had a stale 5 MiB cap and advertised `include_base64` despite ignoring it,
  causing a misleading no-pixels response after provider image preparation.
- Fork `e5d34b37e8837c6fd6d546040d31ab049f4e43f2` labels receipts explicitly as
  `provider_image_and_host_path` or `host_path`, logs raw/encoded provider image
  sizes, aligns metadata inspection to 25 MiB, and removes the unused base64
  claim. Images from 25 to 50 MiB remain durable host attachments and no longer
  receive a false provider-image marker.
- Post-fix verification: 7,432 passed, 14 skipped on x86_64-musl; ReleaseSmall
  build 9/9; formatting and diff checks passed.

### 2026-09-01 02:35 PDT, provider image lost after tool call

- Fork `e5d34b37e8837c6fd6d546040d31ab049f4e43f2` received a real Discord message
  with the 7,756,289-byte JPEG and 222-byte JSON attachment. Both were stored;
  receipts reported `provider_image_and_host_path` and `host_path` respectively.
- Nullclaw logged provider preparation as `mime=image/jpeg raw_bytes=7756289
  encoded_bytes=10341720`. Terra read the JSON nonce through a host tool but then
  said it could not access the photo pixels.
- Root cause: multimodal preprocessing selected only the last user-role message.
  After a tool call, Nullclaw appends its synthetic tool result as a user-role
  message, so subsequent provider requests omitted the original image parts.
- Fork `d33c267d1e19a56bfe21e00395a5e3cc2c7e9a27` carries the current turn's owned
  user-message identity through every provider retry and tool iteration. It does
  not select older image turns and preserves the image-bearing message after
  synthetic tool results are appended.
- Regression coverage checks both multimodal selection and the agent-level
  provider message builder after assistant/tool-result messages. Portable suite:
  7,433 passed, 14 skipped; ReleaseSmall build 9/9; formatting and diff checks
  passed. Git-fixture tests require commit signing disabled because the machine's
  global 1Password signer is unavailable in their temporary repositories.

### 2026-09-01 11:29 PDT, redaction corrupted a generated image path

- The `d33c267d1e19a56bfe21e00395a5e3cc2c7e9a27` live retry stored both files,
  but its JPEG attachment snowflake passed the Luhn check used by PII redaction.
  The generated path segment `1544413731352617010` became `[CARD_1]` before
  multimodal parsing, so every provider iteration logged `PathNotFound` and no
  provider image was prepared.
- The file on disk retained its correct numeric path. This isolated the failure
  to agent-history redaction rather than Discord parsing or durable storage.
- Fork `2f69e013f5e22b9a8d3a3994f47c421291f450f8` preserves only trusted generated
  Discord `path=` values and `[IMAGE:...]` markers while continuing to redact
  surrounding user text, filenames, and receipt metadata.
- Regression coverage uses the exact Luhn-valid live attachment ID and verifies
  that emails elsewhere are still redacted. Portable suite: 7,434 passed, 14
  skipped; ReleaseSmall build 9/9; formatting and diff checks passed.

### 2026-09-01 11:41 PDT, base64 transport exhausted output budget

- The `2f69e013f5e22b9a8d3a3994f47c421291f450f8` retry preserved the numeric path
  and prepared the 7,756,289-byte JPEG on both the initial request and the
  empty-response retry. OpenRouter usage recorded roughly 95–99k prompt tokens
  but exactly 16 completion tokens on each call, followed by `NoResponseContent`.
- Root cause: Nullclaw treated unknown GPT models as 128k-context and estimated
  base64 transport characters at one token per four characters. The 10,341,720
  encoded bytes alone therefore appeared to require about 2.58m prompt tokens,
  reducing requested output to the minimum despite Terra's 1.05m context.
- Fork `1a615ea7325d11cf487891b6b7f020379cdc9b79` registers Terra's 1.05m context
  and 128k output contract, and estimates provider-side image tokens with a
  conservative image-byte proxy rather than text-tokenizing base64 transport.
- A regression using the exact live encoded size proves more than 100k output
  tokens remain available. Portable suite: 7,435 passed, 14 skipped; ReleaseSmall
  build 9/9; formatting and diff checks passed.

### 2026-09-01 11:52 PDT, complete mixed attachment turn passed

- Deployed fork `1a615ea7325d11cf487891b6b7f020379cdc9b79` received the same
  7,756,289-byte JPEG and 222-byte JSON through the real Discord desktop client.
- Receipts reported the JPEG as `provider_image_and_host_path` and JSON as
  `host_path`; both were stored under the deterministic published message store.
- Provider-image preparation occurred three times in order: before Terra's
  `message` tool call, before its `file_read` call, and after `file_read` before
  the final response. This proves the original image survived the complete tool
  loop without persisting base64 in history.
- Terra returned nonce `terra-attachment-e4885c9d` from the durable JSON path and
  described the actual pixels: a large group outdoors beneath leafy trees near
  picnic tables, smiling and cheering with raised arms, several caught mid-jump.
- No warnings or errors occurred in the completed turn.

### 2026-09-01 12:02 PDT, restart hydration passed

- Restarted the exact `1a615ea7325d11cf487891b6b7f020379cdc9b79` binary; service returned
  active and `/health` returned `{"status":"ok"}`.
- A new text-only turn asked Terra to locate the preceding JSON attachment from
  hydrated context and read its durable path. Hydration seeded 58 Discord
  messages, then Terra called `message` followed by `file_read` successfully and
  returned nonce `terra-attachment-e4885c9d`.
- The response rendered the Luhn-valid numeric basename segment as `[CARD_3]`
  under configured PII redaction. The host read itself succeeded against the
  preserved generated receipt path.

### 2026-09-01 12:05 PDT, serial queue ordering passed

- Published two real Discord messages back-to-back while the first requested a
  one-second host wait. Gateway receipt order was A then B, with B arriving while
  A was active.
- Outbound responses remained ordered: `SERIAL-A-1A615EA7` followed by
  `SERIAL-B-1A615EA7`. The A shell call took 1006 ms; no errors occurred.

### 2026-09-01 12:10 PDT, magic-byte fallback and ingress redaction

- Discord rejected a 51 MiB test file client-side because this account has a
  20 MiB upload ceiling. Consequently the live `DeclaredSizeExceedsLimit` and
  25–50 MiB image boundaries remain unproven; their synthetic tests pass.
- A 1 MiB zero-filled file named `.jpg` arrived with declared MIME `image/jpeg`.
  Magic sniffing correctly withheld `actual_mime`, stored it as `host_path`, and
  prepared zero provider images.
- Its Luhn-valid message directory was nevertheless redacted before the earlier
  structured-history helper ran, making a follow-up `od` read target `[CARD_4]`
  and fail. Root cause was a separate whole-message redaction at turn ingress.
- Fork `54a66e2bdf2ad89148fe009e48a1c08cd51a98e5` applies structured path
  preservation at turn ingress as well as history/provider handoff. An end-to-end
  agent test verifies the exact generated path reaches the provider while nearby
  email PII remains redacted.
- Portable suite: 7,436 passed, 14 skipped; ReleaseSmall build 9/9; formatting
  and diff checks passed.

### 2026-09-01 12:24 PDT, host fallback passed

- Deployed `54a66e2bdf2ad89148fe009e48a1c08cd51a98e5` and repeated the 1 MiB
  zero-filled fake JPEG. Receipt fields remained `declared_mime=image/jpeg`,
  `delivery=host_path`, and `status=stored`; no provider image was prepared.
- Terra passed the exact unredacted durable path to `shell`. Raw `od` output was
  privacy-redacted as card-like digits, so a follow-up host predicate emitted
  `EIGHT_ZERO_BYTES_NO_JPEG_MAGIC` after checking all eight NUL bytes and absent
  `ff d8 ff` magic.

### 2026-09-01 12:27 PDT, restarted host path passed

- Restarted the exact deployed binary and health passed. Discord hydration seeded
  55 messages plus its transcript block.
- Terra recovered the fake JPEG's exact numeric durable path from hydrated
  context, then a successful shell predicate returned
  `RESTART_PATH_EXECUTABLE_ZERO_NONJPEG`.
- Live evidence now covers real mixed attachments with provider vision and host
  tools, tool-loop retention, magic-byte fallback, serial ordering, and restart
  hydration. The 25–50 MiB image and over-50 MiB failure boundaries remain
  explicitly unproven live because Discord rejects files above 20 MiB on this
  account; portable boundary tests cover both.

### 2026-09-01 18:10 PDT, directed artifact delivery passed

- Fork `8f2ee88831655a4d61e8f39752825815c145a4af` makes directed group
  requests ineligible for premature `[NO_REPLY]`; the managed workspace also
  requires qualifying acknowledgements to be the first tool without treating
  them as task completion.
- A user-authored artifact turn correctly called `message` first and created its
  report, but neither the acknowledgement nor file appeared in Discord. Terra
  had supplied `account_id=""`; the message tool accepted the empty account as a
  literal route, and its bus enqueue success concealed the dispatcher miss.
- After empty account inheritance was fixed, a second live turn exposed the same
  problem for `chat_id=""`. Fork `bf92c1d82ae506a8ef78af60ea54f0ddcf376e77`
  now normalizes empty or whitespace optional `channel`, `account_id`, and
  `chat_id` values to omitted values before inheriting the current conversation.
  Its regression test uses the full malformed routing shape.
- Portable suite: 7,437 passed, 14 skipped; ReleaseSmall build 9/9; formatting
  and diff checks passed.
- Final user-authored smoke `terra-visible-final-e70c4a1d` used empty account and
  chat IDs in both message calls. Discord visibly rendered `on it.` first, then
  uploaded `terra-visible-final-e70c4a1d.md` as a real attachment with a Discord
  CDN URL, followed by `done.`. The artifact reported installed fork
  `bf92c1d82ae506a8ef78af60ea54f0ddcf376e77`.
- The normal rendered config was restored after the smoke. Doctor remained 21/21,
  the service was active, `/health` returned `{"status":"ok"}`, and Discord
  reached READY.

### 2026-09-02 21:20 UTC, durable scheduler follow-through passed

- Scheduler mutation boundary: one job mutation plus its `cron.json` save. The
  daemon scheduler is authoritative while running; its mutex owns live mutation
  and lifecycle. Scheduler-spawned agent children use an explicit local-store
  path because their parent holds that mutex during execution; the parent's
  post-tick merge preserves child-created jobs. The configured maximum is 64
  jobs, and persisted Discord routing remains attached to each continuation.
- Fork `f412499201d69726715eb49704a1fcd755df83d0` moved internal `schedule`
  operations onto the daemon-owned live scheduler, retained authenticated HTTP
  access for external callers, made successful creation contingent on durable
  save, normalized whitespace-only optional fields, and preserved complete
  Discord delivery context through scheduler-child agent invocations. Prompt and
  managed workspace rules now forbid claiming a watcher before create returns a
  job ID and `get` confirms it.
- Live testing exposed that scheduler instances retained the default restrictive
  shell policy instead of the configured autonomy policy. Fork
  `48755fba3a7b2f984c205f175a0438964d35b6f2` applies the configured policy to
  daemon, scheduler-child, and manual-run schedulers. A script-based watcher can
  therefore run under this deployment's intentional unsandboxed `yolo` policy.
- Failure-boundary proof used one-shot shell job `once-1`, exact command
  `printf 'SCHEDULER_SHELL_RESTART_48755fba'`, account `default`, and Discord
  channel `1475401568173162578`. Creation succeeded, `get` confirmed the job,
  and disk inspection confirmed its one-shot type plus complete inherited
  delivery routing. The daemon was restarted before its due time; the job was
  still present immediately after restart.
- After the due time, `once-1` was absent from `cron.json` and Discord message
  `1544819036049899531` contained exactly
  `SCHEDULER_SHELL_RESTART_48755fba`. This proves persisted reload, post-restart
  execution, one-shot removal, and exact Discord delivery through the real
  deployed topology.
- Earlier agent-job probes also delivered after restart: main-session message
  `1544810877721649333` contextualized the proof, and isolated message
  `1544813693798318222` delivered Terra's output. Those probes demonstrated
  transport but were not accepted as exact-content proof because model output is
  nondeterministic.
- Final portable validation: 7,443 passed, 14 skipped on x86_64-musl;
  `ReleaseSmall`, formatting, and diff checks passed. Installed pin is
  `48755fba3a7b2f984c205f175a0438964d35b6f2`; Doctor is 21/21, service is
  active, health is `{"status":"ok"}`, and Discord reached READY.
- Unproven: `cron.json` replacement and its parent directory are not explicitly
  fsynced, so power-loss durability is not established. Failed remove/update
  saves can briefly diverge in memory until the next disk reload, though the
  operation reports failure and disk remains authoritative. Concurrent local
  fallback writers across separate processes are not serialized when the
  gateway is unavailable.

### 2026-09-02 22:38 PDT, watcher terminal evidence hardened

- Fork `06975d8dcab06c9d179bc08fc30617e32eee5fe8` counts attempted and
  successful tool calls within each agent turn. Scheduler-disabled watcher
  children emit the successful count as a strict machine-readable stderr
  receipt; the parent rejects missing, malformed, duplicate, or overflowing
  receipts.
- A watcher terminal marker with no successful tool call now remains silent and
  re-arms as pending. This closes the observed failure where Terra performed no
  check, claimed the filesystem was inaccessible, and emitted a terminal
  failure that the scheduler accepted.
- The receipt proves only that some tool succeeded. The model still chooses the
  verification tool, so an irrelevant successful call can satisfy the threshold;
  this is an explicit residual risk rather than independent attestation.
- Focused review found no code defects. `zig fmt --check`, `git diff --check`,
  `zig build test -Dtarget=x86_64-linux-musl --summary all`, and
  `zig build -Doptimize=ReleaseSmall --summary all` passed: 7,467 tests passed,
  14 skipped, and the release build completed 9/9 steps. Native debug tests
  remain blocked by the host GCC 16 `.sframe`/`R_X86_64_PC64` linker issue.

### 2026-09-02 23:02 PDT, watcher tool-evidence live proof passed

- Tetrapod deployed exact pin `06975d8dcab06c9d179bc08fc30617e32eee5fe8`.
  The full idempotent bootstrap stopped before Nullclaw on a transient
  `repo.charm.sh` TLS failure, so the deployment used bootstrap's same isolated
  clone, detached checkout, `ReleaseSmall` build, install, pin, and restart
  steps directly.
- A scheduler-disabled child given the adversarial terminal prompt emitted
  `UNVERIFIED_TERMINAL_06975D8D`, `WATCHER_FAILURE`, and trusted receipt
  `successful_tool_calls=0`. The live watcher using that prompt remained present
  with `last_status="pending"`, advanced its next run by exactly 600 seconds,
  and left Discord's latest message unchanged at `1544940256707612772`.
- The first positive watcher prompt was safely re-armed because Terra chose not
  to call the requested tool. A stronger prompt called `shell`; direct child
  diagnostics recorded `success=true`, exact output
  `VERIFIED_TERMINAL_06975D8D`, and receipt `successful_tool_calls=1`.
- Live watcher `agent-once-3` used that exact shell predicate. It removed itself
  after one run, left `cron.json` empty, and delivered exactly
  `VERIFIED_TERMINAL_06975D8D` as Discord message `1544950445125009488`.
- Gateway pairing was disabled only for the loopback-bound test window because
  no reusable plaintext operator token existed after restart. The original
  config was restored byte-for-byte afterward: pairing is required, bind is
  `127.0.0.1`, the service is active, health is `{"status":"ok"}`, Terra remains
  selected, Discord reached READY, and the durable scheduler store is empty.
