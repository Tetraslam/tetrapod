# Tetrapod System Ideas

This document records the current direction. It is a design baseline, not a
claim that every questionnaire answer is a permanent preference. Specific
answers are local evidence; repeated behavior and explicit decisions carry
more weight.

The complete conversation that produced this direction is archived in
[`session-1.md`](session-1.md).
The [questionnaire meme](../questionnaire-meme.png) records the specific
overgeneralization failure mode this document should avoid.

## Shared Principles

- Pursue promising systems in parallel rather than forcing a priority.
- Prefer automatic, low-ceremony operation with inspectable state and broad
  agent access.
- Keep authoritative data portable. Databases and indexes must be rebuildable.
- Permit occasional tinkering, but avoid systems that require a daily habit.
- Keep contradictions and uncertainty instead of flattening answers into a
  universal user profile.

## Idea Map

These are related systems, not a forced product hierarchy. Some may eventually
merge; others may remain independent and exchange data or capabilities through
stable interfaces.

1. **Autonomous project system (name TBD):** Turns ideas into sustained software,
   research, and design projects. "Foundry" is rejected as a name. We will
   heavily fork Stoneforge, but the fork's identity and eventual name remain
   open.
2. **Tetracorpus:** Captures high-fidelity personal data, preserves immutable
   raw inputs, and exposes rebuildable analytical and agent-facing interfaces.
3. **Curator:** Continuously discovers things that may matter, estimates whether
   they are unusually good matches, and acts when confidence and policy allow.
4. **Personal models:** An intentionally broad research area covering models
   trained, adapted, or evaluated for one person. We have not yet decided what
   model classes, objectives, or products deserve to exist.
5. **Public capabilities (shape TBD):** A possible path for turning selected
   outputs into useful APIs, services, datasets, tools, or other artifacts.
   This is not yet established as one coherent layer or system.
6. **Private social coordination:** Creates useful opportunities between trusted
   people while minimizing disclosure, retention, setup burden, and unwanted
   inference.

The examples that motivated these ideas are evidence, not exhaustive product
specifications. In particular, Curator is not merely a media recommender,
personal models are not merely recommenders trained on Tetracorpus, and public
capabilities need not be outputs from the autonomous project system.

## 1. Autonomous Project System (Name TBD)

We will maintain our own heavily modified fork of Stoneforge. Upstream is a
useful starting point, not a product boundary. We may replace behavior,
architecture, terminology, and UI that do not fit the intended system. The
system needs a name that does not evoke Palantir, industrial extraction, or a
generic AI startup.

Stoneforge already supplies useful primitives:

- event-sourced JSONL state with a rebuildable SQLite cache
- dependency-aware tasks, plans, workflows, and agent pools
- isolated git worktrees and automated merge review
- director, worker, and steward roles
- persistent messages, documents, handoffs, and a live dashboard
- Claude Code, OpenCode, and Codex providers

The fork must grow beyond repository-scoped coding orchestration:

- append-only idea intake from text, chat, agents, and an API
- portfolio scheduling across fresh repositories and long-lived workspaces
- heterogeneous software, research, and design projects
- AWS Batch and other elastic execution backends
- Discord escalation for blockers and consequential forks
- wall-clock, compute, spending, permission, and quality constraints, with an
  explicit unbounded mode
- shared research methods, components, failure history, engineering lessons,
  taste, and standards
- live observability across projects, agents, artifacts, cost, and decisions
- durable outputs including production software, prototypes, research results,
  and design explorations

Agents should otherwise proceed as autonomously as possible. The system should
make parallel pursuit cheap rather than ask the operator to choose one idea.

### Questions To Discuss

- What is the central metaphor, if any, and what should the system be called?
- Is an "idea" the root object, or are goals, questions, curiosities, and
  obligations equally fundamental?
- How does it choose what to start, continue, pause, abandon, revive, or combine?
- What is a project across code, mathematical research, empirical research, and
  design work?
- Which decisions require Shresht, and how should Discord escalation work?
- What should the live observatory reveal without turning into management work?
- Which Stoneforge assumptions should survive the fork?

## 2. Tetracorpus

The corpus captures raw data first and keeps it by default. Potential sources
include the laptop, phone, tetrapod, cloud accounts, wearables, and house
sensors. Relevant classes include computer activity, communications, media and
taste, physical activity, location, finance, social graph, and creative work.

Intended uses include personal model training, agent context, pattern discovery,
and unknown future work. Provider-side processing is acceptable when useful.

### Ownership Model

```text
collectors
    |
    v
Tigris raw objects + manifests       authoritative and immutable
    |
    v
normalizers
    |
    +-- derived Parquet in Tigris    portable analytical artifacts
    |
    +-- ClickHouse                   rebuildable serving/index layer
            |
            +-- SQL and APIs
            +-- Grafana
            +-- timeline and search
            +-- model-ready exports
```

The raw object should include or reference its source, capture time, content
hash, media type, collector version, schema version, and provenance. Derived
data may be replaced at any time without touching raw objects.

HPI can supply parsers and normalized Python interfaces for some exported data.
It is not the ingestion or storage substrate. An event stream may notify
downstream consumers, but it is not authoritative.

### ClickHouse Decision

Self-managed single-node ClickHouse is acceptable for this workload and can be
operated through this repository. It has an official ARM64 image, ordinary
Docker deployment, SQL migrations, native Parquet and S3-compatible access,
HTTP and native query interfaces, backups, and strong Grafana support.

The difficult parts are schema and lifecycle design, not keeping one node
running. We avoid the operationally expensive parts initially:

- no cluster, replication, ClickHouse Keeper, or Kubernetes
- no authoritative data stored only in ClickHouse
- no premature real-time ingestion fabric
- no unbounded high-cardinality indexes without measured need

Initial operations should include pinned images, memory and disk limits,
healthchecks, migration files, metrics, deliberate upgrades, and a tested
rebuild from Tigris. Start with batch `INSERT ... SELECT` or explicit imports.
Adopt `S3Queue` only if ingestion latency warrants its extra state and duplicate
handling.

### Questions To Discuss

- Which raw-data contract survives every future collector and schema change?
- What gets captured first, and which sources are too invasive or noisy?
- How do provenance, consent, access control, deletion exceptions, and secrets
  work across personal and third-party data?
- Which interfaces should exist immediately versus emerge from real queries?
- What does a tested full rebuild from raw objects look like?

## 3. Curator

Curator watches selected parts of the world and proposes or performs useful
actions. Candidate actions include saving a link, downloading media, conducting
deeper research, notifying someone, publishing something, or making a small
purchase under an explicit policy. Its defining problem is not retrieval alone:
it must suppress mediocre output, calibrate confidence, explain why something
earned attention, and learn from sparse feedback without becoming repetitive.

### Questions To Discuss

- Which domains should Curator watch, and how are new domains added?
- What does "high confidence" mean when false positives have different costs?
- How should exploration work so strict filtering does not create a taste bubble?
- Which actions can happen silently, which need approval, and which are forbidden?
- How should it learn from acceptance, rejection, ignoring, and later regret?
- Is Curator one persistent agent, a set of domain scouts, ranking models, or a
  protocol connecting all three?

## 4. Personal Models

This is a research program rather than a single planned model. Tetracorpus may
provide training and evaluation data, but collection should not be distorted
around today's model ideas. Possibilities include retrieval and reranking,
preference and value models, context selection, personal embeddings, behavior
prediction, interfaces adapted to one user, generative models, and models of
relationships or environments. Some may be fine-tunes of foundation models;
others may be small models trained from scratch.

### Questions To Discuss

- Which capabilities improve enough with personalization to justify training?
- What can be learned from implicit behavior versus explicit labels?
- How do we construct honest temporal evaluations instead of flattering demos?
- Which models should run locally, on tetrapod, or through compute providers?
- How do models represent uncertainty, changing preferences, contradictions,
  private contexts, and multiple social roles?
- What should never be inferred even if the data permits it?

## 5. Public Capabilities (Shape TBD)

There is interest in making things that are genuinely usable rather than ending
every project as a private demo or blog post. The unit might be an API, hosted
tool, protocol, dataset, model, interactive artifact, public agent, or something
else. It is not clear that these form one architectural layer, so this remains a
question rather than a committed subsystem.

### Questions To Discuss

- What private work becomes more valuable when exposed publicly?
- Who are the plausible users: friends, other agents, researchers, niche
  communities, or strangers?
- What should be promoted automatically versus deliberately productized?
- Which capabilities can be public without leaking Tetracorpus or private model
  information?
- What would make an output a maintained service rather than abandoned residue?

## 6. Private Social Coordination

This system seeks rare, useful opportunities between trusted people without
requiring them to expose a continuous social or location feed. The motivating
nearby-friend notification is one example, not the whole category. Other forms
could coordinate shared interests, availability, mutual intentions, lending,
events, introductions, purchases, travel, or collaborative projects.

Its hardest constraint may be adoption rather than cryptography. A technically
elegant protocol that asks every friend to install and maintain unfamiliar
software will lose to a worse feature already present on their phones.

### Questions To Discuss

- Which coordination failures are common or valuable enough to solve?
- What can work through links, messages, calendars, or existing apps rather than
  requiring installation?
- What information can be matched privately without either party disclosing it?
- How do mutual consent, expiry, revocation, abuse prevention, and social
  awkwardness work?
- Could useful coordination occur with friends who never become system users?

## Initial Build Sequence

1. Create and document the Stoneforge fork, then run it against a disposable
   repository while mapping the first architectural changes.
2. Define the raw object and manifest contract, create the Tigris bucket, and
   implement authenticated ingestion with a local retry spool.
3. Add two useful collectors, likely ActivityWatch and GitHub, without waiting
   for the complete platform.
4. Normalize selected raw objects to Parquet and prove a full ClickHouse rebuild.
5. Add Grafana and agent-facing SQL/API access.
6. Extend the autonomous project system with global intake, Discord escalation,
   research jobs, and cross-project memory.
