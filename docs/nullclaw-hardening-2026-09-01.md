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
