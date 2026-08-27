# Remote-Local Agent Runtime

This is a planned system independent of Tetrarium. Tetrarium may eventually use
it, but the runtime should also serve ordinary interactive agents and other
orchestrators.

## Goal

Keep the primary agent process on an always-on remote host while allowing it to
use an intermittently connected personal computer as naturally as a local
agent. The remote agent should continue working when the computer sleeps or
disconnects, recognize which local capabilities became unavailable, and resume
or queue local work when the computer returns.

The desired experience is one durable remote OpenCode session with access to:

- remote repositories, compute, services, and network access
- approved files, repositories, shell commands, and LAN resources on the laptop
- authenticated local browser or desktop capabilities when explicitly allowed
- host-local test harnesses such as `opencode-gpui`'s private Weston renderer
- delegated local OpenCode agents managed by Herdr for extended local work

SSH proves reachability. The runtime becomes useful when it also gives local
work stable identities, explicit availability, structured results, and safe
recovery after a disconnect.

## Execution Model

```text
remote OpenCode session
  -> agent-facing tools
  -> durable coordinator on tetrapod
  -> intermittently connected laptop worker
       -> shell and files
       -> browser and network
       -> desktop test adapters
       -> local Herdr and OpenCode agents
```

There are three execution modes:

1. Run ordinary work in the remote checkout so it survives laptop absence.
2. Execute a bounded typed operation on the laptop and return structured output
   or artifacts.
3. Delegate high-bandwidth local work to a local Herdr-managed OpenCode agent,
   while the remote session remains the durable parent.

The third mode avoids turning a long local investigation into thousands of
fine-grained network calls. The remote parent can start, prompt, wait for, read,
and later reattach to the local agent through a host worker backed by Herdr.

## Existing Primitives

- `dotagents/bin/opencodr` gives local repositories and durable roles stable
  Herdr identities.
- Tailscale provides private connectivity and operator SSH without public
  laptop ingress.
- `opencode-gpui/scripts/private-weston.sh` starts a private headless Wayland
  compositor with isolated XDG state. Its capture, matrix, comparison, and
  profiling scripts are already bounded desktop jobs with useful artifacts.
- Herdr can start, prompt, observe, resume, and directly attach to local OpenCode
  agents. It is a host-local executor, not the cross-host coordinator.

The Weston harness should become an early typed adapter such as
`desktop.capture`, not a remotely exposed Wayland session. Deterministic input,
screenshots, diffs, profiles, deadlines, logs, and cleanup cross the host
boundary better than raw desktop control.

## Availability And Jobs

A laptop operation must not leave the remote agent blocked indefinitely. It
should produce a result or durable job identity with a state such as:

```text
queued -> leased -> running -> succeeded | failed
                         \-> waiting-for-laptop
                         \-> approval-required
                         \-> completion-uncertain
```

Each job needs an immutable ID, requested capability and host, working
directory, timeout, attempt, heartbeat or lease, structured result, and artifact
references. If a connection disappears, destructive operations must be
reconciled by job ID rather than blindly retried.

Host presence and capability availability are separate from job state. A
laptop may be online while its desktop harness, authenticated browser, local
checkout, or required network is unavailable.

## Source State

Direct laptop operations may work in an existing checkout and therefore require
that laptop. Durable remote work should use a separate remote worktree or
branch. Do not use bidirectional home-directory synchronization or silently
overwrite a laptop checkout.

When dirty state must move, use an explicit workspace snapshot containing the
repository identity, HEAD and branch, staged and unstaged patches, allowlisted
untracked files, submodule or LFS state, and artifact references. Exclude ignored
files and secrets by default. A multi-repository task uses a manifest of these
snapshots and reconciles changes through Git and three-way merges.

## Authority

The personal deployment can deliberately grant broad access equivalent to a
trusted local agent. The portable design must still make that grant explicit.
Profiles should be able to constrain allowed roots, arbitrary shell access,
desktop and browser control, LAN access, secret resolution, and actions that
require local approval.

The laptop worker connects outbound, authorizes every requested capability
locally, and records the requesting session, operation, arguments, policy
decision, timestamps, result, and artifact hashes. Credentials remain on the
host that owns them whenever practical.

## What To Build

### 1. Typed SSH baseline

Wrap the useful operations in tracked commands with JSON output, explicit
working directories, timeouts, and operation IDs. Initial examples:

```text
host status
host exec
desktop capture
desktop profile
local agent start|prompt|wait|read
```

Use normal SSH underneath, including the planned `opencodr remote <profile>
[role]` flow. This stage discovers the real capability vocabulary before
introducing a service or protocol.

### 2. Laptop worker and coordinator

Replace synchronous SSH orchestration with a laptop user service that maintains
an outbound authenticated connection, advertises capabilities, heartbeats, and
pulls leased jobs. A small coordinator on tetrapod owns job state and artifacts.
Choose the simplest durable store and transport justified by the SSH baseline;
do not add Temporal, NATS, or another workflow system until observed load or
recovery requirements justify it.

### 3. Agent-facing tool facade

Expose stable host and job tools to remote OpenCode through MCP. Keep the MCP
endpoint alive when the laptop is offline and return explicit availability or
queued-job results instead of dynamically removing tools. MCP is the model-facing
interface, not the durable queue.

### 4. Herdr adapter

Let the coordinator create and supervise local OpenCode roles through Herdr.
Feed local and remote lifecycle state into the same status surface while keeping
each host's PTYs, sockets, and process state independent.

### 5. Workspace handoff

Add Git-backed dirty-state snapshots and multi-repository manifests only after
remote execution and host jobs work reliably. Prefer normal branches, worktrees,
and commits whenever they are sufficient.

### 6. Generalize after a second use

Keep the first implementation in tetrapod. Extract a standalone, self-hostable
device worker and protocol only after another host, orchestrator, or user proves
the boundary. Do not predetermine the supported device classes or require
OpenCode or Tetrarium in the extracted protocol.

## Complexity Guardrails

- Build each stage only when the previous stage exposes a concrete limitation.
- Do not begin with a workflow engine, generic scheduler, or live filesystem
  synchronization layer.
- Keep SSH as the operator recovery path even after jobs use another transport.
- Prefer typed adapters and artifacts over remotely streaming raw desktops or
  arbitrary internal sockets.
- Keep the remote agent session authoritative; local agents are delegates, not
  competing orchestrators.
- Treat offline and uncertain completion as normal states rather than exceptional
  transport errors.

## Open Questions

- Which first three SSH operations provide enough evidence for the worker API?
- Which laptop actions may run without approval in the personal full-trust
  profile?
- How should a remote parent summarize and incorporate a delegated local agent's
  work without copying its entire conversation?
- Which operations need streaming output, and which should return only artifacts
  and a final result?
- When should laptop work wait, fail, or move to a remote substitute?
