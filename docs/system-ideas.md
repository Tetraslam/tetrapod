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

1. Design Tetrarium's repository templates and test OpenCode 2 against a
   disposable pursuit while its API remains in beta.
2. Define the raw object and manifest contract, create the Tigris bucket, and
   implement authenticated ingestion with a local retry spool.
3. Add two useful collectors, likely ActivityWatch and GitHub, without waiting
   for the complete platform.
4. Normalize selected raw objects to Parquet and prove a full ClickHouse rebuild.
5. Add Grafana and agent-facing SQL/API access.
6. Build Tetrarium's OpenCode integration after the stable V2 contracts land.
