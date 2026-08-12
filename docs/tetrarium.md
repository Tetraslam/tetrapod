# Tetrarium

Tetrarium is an autonomous, steerable environment for long-running pursuits.
It turns every submitted entry into a repository-backed project and keeps that
project moving until Shresht explicitly stops it.

This document records current product decisions. It should become more precise
as the design is discussed; it is not an implementation plan yet.

## Invariants

- Every entry starts a pursuit. Tetrarium does not reject, rank away, or archive
  an entry instead of pursuing it.
- A pursuit continues indefinitely. Failure, low expected value, or a long map
  of attempted approaches is not a terminal outcome.
- Only Shresht decides to stop a pursuit.
- Every pursuit has a Git repository as its durable home, including
  mathematical research, literature synthesis, model experiments, and design.
- Everything is steerable while it runs, like a normal OpenCode session.
- There is at most one active main-agent run per pursuit. A pursuit may have
  many main-agent runs over time and concurrent subagent runs.
- Project knowledge, decisions, methods, and useful lessons live in the pursuit
  repository rather than a separate universal knowledge ontology.
- The orchestrator keeps pursuits healthy. It does not decide which pursuits
  deserve attention or ask Shresht to manage routine task allocation.

## Ontology

### Entry

The raw input submitted through a ledger, chat, an agent, or an API. An entry
may be an idea, desire, question, observation, link, or instruction. Submission
creates a pursuit rather than entering a discretionary backlog.

### Pursuit

The complete project stemming from one entry. Its repository is the durable
unit of state and contains whatever the work needs: code, prose, experiments,
data references, plans, results, agent instructions, and history.

A pursuit can change its approach, expand its scope, and produce many artifacts
without becoming a hierarchy of first-class Tetrarium objects.

### Run

One agent execution inside a pursuit. A run may be the pursuit's main agent or
a subagent. Main runs can be long-lived, resumed, steered while active, or
replaced with a fresh-context main run. Only one main run is active at a time.

### Artifact

A useful output of a pursuit, such as software, a service, model, dataset,
paper, proof, benchmark, design, prototype, or research result. Artifacts may
live in the repository or be referenced from it when their size or deployment
requires external storage.

## Repository Contract

Repositories are part of Tetrarium's execution model rather than incidental
outputs. Tetrarium should create them from a small set of excellent templates
and enforce their conventions mechanically where practical.

Existing examples include
[`tetraslam/playground`](https://github.com/tetraslam/playground) and
[`tetraslam/lispium`](https://github.com/tetraslam/lispium). Relevant patterns
from `playground` include:

- one coherent workspace and lockfile per toolchain
- `uv`, `pnpm`, `cargo`, and Go workspace support where appropriate
- committed 1Password references with runtime secret resolution
- explicit `AGENTS.md` instructions
- repository-local tools and hooks that enforce important rules
- generated or visual examples committed when they are part of the result
- durable feedback written into the repository instead of disappearing in chat

Dependency changes must use the package manager, such as `uv add <package>`,
`pnpm add <package>`, `cargo add <package>`, or `go get <package>`. Agents must
not type dependency versions into manifests by hand. Templates should enforce
this through hooks or CI rather than relying only on prose.

We still need to design:

- the common base template
- specialized software, research, ML, and design templates
- the stock Tetrarium `AGENTS.md`
- required checks, formatting, artifact handling, and secret conventions
- how template improvements propagate to existing pursuits
- how large datasets and model weights are referenced without bloating Git

## Agent Operation

Each pursuit has a main agent responsible for continuing the work. It may spawn
subagents when parallelism or specialization helps. Starting a fresh main run
must not reset the pursuit: the repository should contain enough current state
for a new agent to understand the entry, prior work, active direction, and
relevant evidence without replaying every old conversation.

Steering should be conversational. Shresht can message an active run, redirect
an approach, add constraints, request an explanation, or provide new evidence.
The response should affect the running session promptly rather than becoming a
ticket another scheduler interprets later.

Individual pursuit agents may contact Shresht directly when they need a real
answer. The orchestrator may contact him when a pursuit is unhealthy or cannot
continue autonomously.

## Orchestrator

The central orchestrator is operational, not managerial. It should ensure that:

- every entry has a repository and an active or recoverably scheduled pursuit
- runs start, resume, and recover correctly
- no pursuit silently stalls
- one main run per pursuit is respected
- subagents and external compute jobs remain observable
- credentials, repositories, workspaces, and provider access are functioning
- actionable failures reach Shresht

It should handle ordinary failures itself. Notifications should describe a
decision or action Shresht must take, not merely report that an agent encountered
an error.

## Communication Style

Discord messages must use ISO simple language: short, grammatical sentences,
ordinary words, and explicit referents. They should be extremely concise without
dropping information needed to decide or act. Sentence fragments, status noise,
management jargon, and long agent-authored incident reports are unacceptable.

A useful escalation usually contains:

- what cannot continue
- why Tetrarium could not resolve it
- the smallest action or decision needed
- the agent's recommendation when there is a real choice

These should normally fit in a few short sentences.

## OpenCode Architecture

Tetrarium should probably be built directly around OpenCode instead of adopting
Stoneforge's superapp model. Tetrarium owns pursuits, repositories, health,
notifications, and its observatory. OpenCode owns agent sessions, tools, model
interaction, permissions, compaction, and subagents.

OpenCode 2 is currently beta. It introduces a revised server API, new clients,
and a background service architecture suitable for multiple clients and
projects. Its official migration documentation says the server and client
contracts are still being finalized. Building a deep integration against that
moving contract would create disposable work.

The sensible boundary is:

- design Tetrarium's domain model, templates, UI, and operational contracts now
- test OpenCode 2 manually and study its events and API during beta
- implement the durable integration once the V2 API is stable
- keep Tetrarium's database small and avoid copying OpenCode's session model

Stoneforge remains useful prior art for worktrees, live observability, and
recovery behavior, but Tetrarium does not need its all-in-one issue tracker,
documents, messages, task ontology, or fixed agent roles.

## Open Questions

- Does each entry always create a new repository, or can Shresht explicitly add
  an entry to an existing pursuit?
- When should Tetrarium replace a main run with fresh context?
- What summary or repository file hands state from one main run to the next?
- Can a pursuit intentionally wait for an external event, or must it always have
  an agent actively searching for another approach?
- What exact health states exist between healthy and requiring human action?
- How should the observatory present dozens or hundreds of indefinite pursuits?
- What belongs in Tetrarium's own database beyond IDs, repository locations,
  run references, health, and notification state?
