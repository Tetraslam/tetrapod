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

1. **Tetrarium:** Turns every submitted entry into an indefinitely pursued,
   repository-backed software, research, or design project. See
   [`tetrarium.md`](tetrarium.md).
2. **Tetracorpus:** Captures high-fidelity personal data, preserves immutable
   raw inputs, and exposes rebuildable analytical and agent-facing interfaces.
   See [`tetracorpus.md`](tetracorpus.md).
3. **Curator:** Continuously discovers things that may matter, estimates whether
   they are unusually good matches, and acts when confidence and policy allow.
   See [`curator.md`](curator.md).
4. **Personal models:** An intentionally broad research area covering models
   trained, adapted, or evaluated for one person. We have not yet decided what
   model classes, objectives, or products deserve to exist. See
   [`personal-models.md`](personal-models.md).
5. **Public outputs:** A property of the other systems: publish useful packages,
   models, datasets, APIs, services, recommendations, methods, and research when
   appropriate. This is not a separate platform.
6. **Private social coordination:** Creates useful opportunities between trusted
   people while minimizing disclosure, retention, setup burden, and unwanted
   inference.

The examples that motivated these ideas are evidence, not exhaustive product
specifications. In particular, Curator is not merely a media recommender,
personal models are not merely recommenders trained on Tetracorpus, and public
capabilities need not be outputs from Tetrarium.

## 1. Tetrarium

Tetrarium is an autonomous, steerable environment for long-running pursuits.
Every entry starts a pursuit. Every pursuit owns a repository, receives one or
more OpenCode runs over its lifetime, and continues until Shresht explicitly
stops it.

Its complete current design is in [`tetrarium.md`](tetrarium.md). The core
ontology is deliberately small:

- **entry:** raw input submitted to Tetrarium
- **pursuit:** the repository-backed project created from one entry
- **run:** one main-agent or subagent execution within a pursuit
- **artifact:** a useful output produced by a pursuit

Tetrarium will likely be its own thin orchestration system around OpenCode rather
than a Stoneforge fork. OpenCode 2's single background server and client API fit
the intended architecture, but its server contracts are still being finalized
during beta. Design and repository-template work can proceed now; tight API
integration should target the stable V2 release.

### Questions To Discuss

- How should Tetrarium turn arbitrary entries into well-scaffolded repositories?
- Which repository templates are needed, and what belongs in every template?
- How should a new main run inherit context from earlier runs without preserving
  all conversational baggage?
- How should steering work across the UI, terminal, Discord, and API?
- What exactly counts as "wrong" enough for the orchestrator to notify Shresht?
- What should the live observatory reveal without turning into management work?
- Which OpenCode V2 events and controls should Tetrarium persist itself?

## 2. Tetracorpus

Tetracorpus captures raw personal data, keeps it by default, and includes the
interfaces for searching, querying, visualizing, streaming, and exporting it.
Tigris stores authoritative source material; ClickHouse and other derived stores
remain rebuildable. The complete current design is in
[`tetracorpus.md`](tetracorpus.md).

### Questions To Discuss

- Which sources are technically collectible, and what collection method does
  each source support?
- What exact raw-object and capture-record contracts should implementations use?
- Which sources should be the first implementation slice?
- What does a tested full rebuild from raw objects look like?

## 3. Curator

Curator is a family of domain agents plus a general cross-domain agent. Each
agent has its own prompt, tools, sources, and rules. Agents can use learned
rankers when useful, but remain responsible for contextual judgment and action.
The complete current design is in [`curator.md`](curator.md).

### Questions To Discuss

- What tools and rules does each initial domain agent need?
- Which candidate sources are technically available for each domain?
- What common candidate and feedback records should agents share?
- When is enough personal feedback available to train the first learned ranker?

## 4. Personal Models

Personal models are actual trained models owned by Shresht, not a synonym for
agent memory or Tetracorpus. Promising areas include preference learning,
longitudinal prediction, health and behavior forecasting, personal simulation,
style and taste models, and generative models trained on personal data. The
complete current map is in [`personal-models.md`](personal-models.md).

### Questions To Discuss

- Which proposed model families become compelling once Tetracorpus has enough
  history?
- Which explicit labels and self-reports are worth collecting?
- Which models should be the first research pursuits?
- What does direct action by a personal model mean, if anything, beyond serving
  predictions or representations to agents?

## 5. Public Outputs

Useful outputs should become public when appropriate. This is a property of
Tetrarium, Curator, Tetracorpus, and personal-model work rather than a separate
capability layer. Prefer durable outputs that do not demand constant maintenance,
such as packages, models, datasets, methods, protocols, and reproducible research.
Public APIs and services remain worthwhile when their value justifies operation.

Public outputs may serve humans, agents, or both. Tetrarium may autonomously
propose that an artifact be prepared and maintained for public use.

Curator can produce both private recommendations and public recommendation feeds
or channels, including domain-specific lists such as manga recommendations.
Personalized public outputs are acceptable when they do not expose the private
history that generated them.

Examples include:

- models that generalize beyond Shresht
- tools or recipes that let others train their own personal models
- packages that normalize data from many services
- open-source kernels or algorithms that improve a measured result
- public recommendation feeds
- datasets, benchmarks, APIs, and hosted tools
- research results and reproducible methods

### Questions To Discuss

- What evidence should support Tetrarium's proposal to publish an artifact?
- How should public recommendation channels separate private evidence from
  shareable explanations?
- Which outputs need continued ownership after publication, and which can be
  complete releases?

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

1. Design Tetrarium's repository templates and test OpenCode 2 against a
   disposable pursuit while its API remains in beta.
2. Define the raw object and manifest contract, create the Tigris bucket, and
   implement authenticated ingestion with a local retry spool.
3. Add two useful collectors, likely ActivityWatch and GitHub, without waiting
   for the complete platform.
4. Normalize selected raw objects to Parquet and prove a full ClickHouse rebuild.
5. Add Grafana and agent-facing SQL/API access.
6. Build Tetrarium's OpenCode integration after the stable V2 contracts land.
