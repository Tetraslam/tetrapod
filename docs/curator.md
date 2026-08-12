# Curator

Curator is a family of autonomous agents that discover things Shresht may value,
judge them under domain-specific rules and current context, and take useful
actions through tools. A general Curator agent can work across domains and find
connections that no individual domain agent would see.

This document records the current design discussion. No Curator implementation
work has started.

## Agent Model

Each domain curator is an agent defined primarily by:

- a prompt describing its domain, standards, and behavior
- source and search tools
- access to relevant Tetracorpus scopes or another context pool
- domain-specific action tools
- an index of known, considered, suggested, and acted-on items
- feedback from earlier recommendations and actions
- optional learned ranking tools

The agents do not need to follow one fixed retrieval pipeline. A movie curator
may rely on release databases, reviews, watch history, and Seerr. A paper curator
may use literature search, citation graphs, pursuit context, and full-text
analysis. Their rules and false-positive costs differ.

The general Curator agent receives broader tools and context. It can discover
cross-domain opportunities, such as a paper relevant to a Tetrarium pursuit, an
event involving a recently discovered artist, or software that changes how a
personal-data source can be collected. It may call domain tools or ask a domain
curator for specialized judgment.

## Initial Domains

- movies
- television
- anime
- manga
- papers
- events, including Luma, Partiful, and other event sources
- software
- shopping
- NSFW material, including selected Reddit communities, Audiochan, and other
  explicitly configured sources
- YouTube videos

Starting with all of these domains does not require implementing them at once or
giving them identical architecture. It means the design should accommodate all
of them rather than choosing one as the definition of Curator.

## Candidate Memory

Curator needs a shared index of items it already knows about. At minimum, an
item can be:

- discovered
- already known to Shresht
- evaluated
- suggested
- acted on
- accepted
- rejected
- ignored because Shresht was busy

The exact state model can remain loose until implementation. Its purpose is to
prevent repetitive discovery and make prior interactions available to agents
and rankers.

An item that has already been suggested should not be suggested again unless
there is a strong new reason. Reconsideration remains useful because context
changes and old items can become newly relevant. A repeated suggestion should
state the new evidence or changed context that justified it.

For now, silence after a notification means "busy," not negative feedback.
Shresht expects to provide explicit feedback often enough that Curator should
not guess too much from non-response.

## Context

Curator agents can use scoped Tetracorpus access or another assembled context
pool. Relevant context may include long-term taste, current pursuits, recent
media, calendar and location, purchases, current interests, available time, and
prior Curator interactions.

Context is not one permanent user profile. Agents should distinguish durable
patterns from temporary circumstances and preserve contradictions rather than
forcing all behavior into one preference vector.

## Learned Rankers

A learned ranker is a model that scores or orders candidates using examples of
what Shresht accepted, rejected, watched, read, bought, saved, skipped, or rated.
It is a tool available to Curator agents, not a replacement for them.

A candidate ranker might receive:

```text
candidate features
  title, description, creators, topics, embeddings, reviews, release date

personal features
  related history, explicit feedback, known creators, prior domain behavior

temporary context
  current pursuits, recent activity, time, location, calendar, current media
```

It returns a score or ordered candidate list. The curator agent can then inspect
the strongest candidates, gather more evidence, apply domain rules, and choose
an action.

### Training Signals

Rankers can learn from several kinds of examples:

- **Pointwise:** Predict a label or utility score for one item, such as liked,
  rejected, completed, or purchased.
- **Pairwise:** Learn that item A was preferred to item B. This often matches
  ranking more directly than predicting an absolute rating.
- **Listwise:** Learn from the ordering or outcomes of a whole candidate list.
- **Implicit:** Use behavior such as finishing a show, replaying a song, saving a
  paper, or uninstalling software. These signals are abundant but ambiguous.
- **Explicit:** Use direct reactions or comparisons. These are sparse but much
  clearer.

For one person, the main difficulty is sparse data. The first useful ranker does
not need to be a large model trained from scratch. It can combine pretrained
text or media embeddings with a small model such as logistic regression,
gradient-boosted trees, or a compact neural scorer. Domain agents and foundation
models can provide useful semantic features before enough personal examples
exist.

A practical progression is:

1. Domain agents judge candidates directly using instructions and context.
2. Curator records candidates, decisions, actions, and explicit feedback.
3. A simple domain ranker learns from this history and becomes a curator tool.
4. The agent uses the ranker to screen or order large candidate pools, while
   retaining final judgment.
5. More advanced preference models or contextual bandits are added only when
   measured evaluation shows that they improve decisions.

A contextual bandit can eventually trade off familiar high-confidence items
against deliberate exploration. It chooses an item under the current context,
observes feedback, and updates its policy. This is useful for discovering new
tastes, but premature bandit optimization would learn from too few, noisy
interactions and may optimize notification behavior instead of actual value.

Rankers should be evaluated on future time periods, not random examples from the
same history. Otherwise near-duplicates and temporal leakage can make a personal
model look far better than it will be on genuinely new candidates.

## Actions And Notifications

Actions are tools. Domain prompts and tool permissions determine which actions
an agent may take. Candidate actions include:

- save or archive an item
- download media
- add media to a queue or request system
- perform deeper research
- notify Shresht
- create a Tetrarium entry
- request approval for a purchase
- make a future autonomous purchase when separately authorized

Agents decide whether and when to use these tools. Different domains can have
different interruption behavior without a central notification budget.

Curator normally notifies Shresht only after it has acted or when an action
requires approval. Sending a notification is itself an easy tool call, so an
agent can notify in an unusual case when its judgment says that is useful.

Notifications should include a short explanation of why the item earned
attention. The explanation should cite concrete evidence or context rather than
produce a persuasive essay.

Purchases require Shresht's approval initially, regardless of price. A shopping
curator can request an expensive item when it appears useful without having
authority to spend. Purchase autonomy can increase later from observed behavior
and explicit permission.

Curator may create Tetrarium entries autonomously. This commitment is easy to
make before Tetrarium exists and can be revisited when autonomous entries would
actually start indefinite pursuits.

## Exploration

High confidence should not mean recommending only close copies of known items.
Curator can preserve exploration through the known-item index, domain-agent
judgment, candidate diversity, and eventually learned ranking methods that
reserve some attention for uncertain but promising candidates.

The goal is useful surprise, not novelty for its own sake. Curator should remain
quiet when it lacks a strong candidate, but it should search beyond the narrow
surface implied by past behavior.

## Remaining Design Work

- Define a minimal shared candidate and feedback record.
- Investigate candidate sources and action APIs for every initial domain.
- Design each domain curator's prompt, tools, Tetracorpus scopes, and rules.
- Decide where the known-item index lives and how entities are deduplicated
  across sources.
- Specify how the general Curator invokes or consults domain curators.
- Design concise feedback interactions that produce useful labels without
  becoming homework.
- Establish temporal evaluations before training learned rankers.
- Decide which first actions can run unattended and how their outcomes are
  recorded.
