# Tetracorpus

Tetracorpus is a raw-first personal data system. It continuously or periodically
captures data from Shresht's devices, accounts, services, and environment;
preserves authoritative source material in Tigris; and provides integrated
search, SQL, timelines, Grafana, event access, and model-ready exports.

This document records the current design discussion. No Tetracorpus
implementation work has started.

## Purposes

- Preserve high-fidelity personal data for unknown future uses.
- Give local agents broad, structured context when authorized.
- Support personal model training and evaluation.
- Reveal patterns across services that cannot analyze one another.
- Make provider exports and histories durable, portable, and queryable.

Collection should not be narrowed around today's model or dashboard ideas.

## Data Layers

Tetracorpus distinguishes source material, capture records, and derived data.

### Source Material

The exact bytes received or copied from a source: API responses, provider export
archives, database snapshots, files, event batches, or collector payloads. These
objects are authoritative and retain their native format.

### Capture Record

Small Tetracorpus metadata associated with source material. It identifies the
source, account or device, capture time, source time range when known, content
hash, media type, collector and collector version, schema version, provenance,
and storage object.

### Derived Data

Normalized records, Parquet datasets, ClickHouse tables, extracted text,
embeddings, search indexes, timelines, and model datasets. All derived data may
be replaced and rebuilt without changing source material.

HPI may supply parsers and normalized Python interfaces for compatible exports.
It is a derivation library, not the ingestion or storage substrate.

## Storage And Deletion

Tigris stores source material and portable derived Parquet. Application behavior
is append-only by default, and bucket versioning provides recovery from accidental
replacement or deletion. Enforced object lock is unnecessary.

True deletion must remain possible. It should be well guarded because deletion
may need to remove:

- all versions of source objects
- capture records
- local collector spools and caches
- derived Parquet
- ClickHouse rows and indexes
- search and embedding data
- backups where practical under the chosen retention policy

The exact deletion ceremony can be designed later. It should make accidental or
agent-initiated deletion difficult without making deliberate deletion fake.

Data concerning other people does not receive a separate storage architecture
by default. The corpus is primarily personal, and relatively little collected
data concerns others. Source-specific access or deletion rules can still be
added where genuinely needed.

## Capture Policy

Capture continuously when doing so has negligible battery and device impact.
Capture laptop-dependent or heavier sources periodically, initially once per
day like the existing restic backup. Each source may later use a better interval
based on cost, API limits, and how often its data changes.

Screen recording, keystroke logging, clipboard history, ambient microphone
audio, and camera capture are out of scope. Their storage growth and invasiveness
do not justify their current value.

New data should become available as quickly as the source and pipeline allow
without risking loss. There is no reason to impose batch latency merely for
architectural uniformity. A continuously collected source may reach derived
interfaces within seconds, while a daily export naturally appears after its
daily capture.

Durability takes precedence over indexing latency: source material must be
stored safely before downstream processing treats it as captured.

## Ingestion Architecture

Collectors should use a shared Tetracorpus ingestion service rather than each
implementing Tigris layout, authentication, manifests, deduplication, deletion
bookkeeping, event publication, and retry semantics independently.

The ingestion service provides:

- one authenticated upload and capture-registration API
- streaming uploads so large payloads do not pass through application memory
- content hashing and idempotency
- canonical capture records and object-key allocation
- source-level scope checks
- durable acknowledgement only after Tigris accepts the object
- publication of derivation events after durable storage
- centralized observability and deletion bookkeeping

Collectors still need local spools. If tetrapod, Tigris, or the network is
unavailable, a collector saves its payload locally and retries. The service
therefore reduces client work without becoming a point of data loss.

Direct-to-Tigris uploads may later be useful for very large objects. The service
can issue a short-lived presigned upload, then register the completed capture.
This preserves centralized control without proxying every byte through
tetrapod.

The tradeoff is that the ingest API becomes infrastructure that collectors must
track. This is acceptable because its contract can remain deliberately small
and stable, while direct collectors would otherwise duplicate more fragile
logic and receive long-lived bucket credentials.

## Derivation And Query

```text
collectors with local spools
            |
            v
Tetracorpus ingest API
            |
            +-- source material + capture records --> Tigris
            |
            +-- durable capture event
                        |
                        v
                   normalizers
                        |
                        +-- Parquet --> Tigris
                        |
                        +-- query tables --> ClickHouse
                        |
                        +-- text and embeddings --> search
```

Single-node self-managed ClickHouse is acceptable for the initial analytical
serving layer. It has an official ARM64 image, ordinary Docker deployment,
native Parquet and S3-compatible access, HTTP and native query interfaces,
backups, and Grafana support.

ClickHouse is not authoritative. Initial operation should avoid clustering,
replication, ClickHouse Keeper, Kubernetes, and an unnecessary real-time queue.
Use pinned images, healthchecks, migrations, metrics, deliberate upgrades, and
a tested rebuild from Tigris. Start with explicit imports or batch
`INSERT ... SELECT`; add `S3Queue` only if measured ingestion latency warrants
its extra state and duplicate handling.

## Product Interfaces

Tetracorpus itself includes:

- SQL access
- files and object-storage access
- full-text and semantic search APIs
- an event stream for newly captured and derived data
- model-ready exports
- a visual timeline
- Grafana data sources and dashboards
- administrative views for collectors, freshness, failures, storage, scopes,
  derivations, and deletion

These interfaces may use separate processes or existing tools, but they belong
to the Tetracorpus product rather than being unrelated applications the user
must assemble.

## Access Control

Access is scope based. Scopes should be able to select sources and classes of
derived data. A superuser scope exposes the whole corpus for Shresht and trusted
local agents, including normal local OpenCode sessions.

The exact scope model can wait until implementation. The initial architecture
must avoid assumptions that every future agent receives unrestricted access.
Collectors receive only the write permissions needed for their own sources.

## Candidate Sources

The source inventory is intentionally broad. Inclusion here means worth
investigating, not that every collector is equally feasible or urgent.

### Accounts And Communication

- X/Twitter
- Instagram
- Discord
- Reddit
- sent Gmail
- Google Calendar
- Claude conversations
- OpenCode sessions
- Partiful

### Browsing And Device Activity

- ActivityWatch
- Zen Browser
- Opera Mobile
- other useful mobile-device data
- location history

### Media And Taste

- Spotify
- Crunchyroll
- Jellyfin
- Steam
- other tetrapod media services

### Purchases, Travel, And Services

- Amazon orders
- DoorDash
- Uber
- Uber Eats
- Waymo
- Lime
- Ticketmaster

### Finance And Health

- Mercury, including its authenticated CLI
- Robinhood
- Eight Sleep

### Engineering And Infrastructure

- GitHub
- all useful tetrapod services
- OpenCode

The eventual source registry should record collection method, available history,
capture interval, credentials, rate limits, raw format, expected volume,
freshness, and known gaps for each source.

## Remaining Design Work

- Specify the minimal ingestion and capture-record API.
- Investigate each candidate source and classify its collection method.
- Choose a small first implementation slice after feasibility research.
- Define local spool behavior and disk limits for laptop, phone, and server
  collectors.
- Design true deletion across source and derived layers.
- Design the initial scope vocabulary and superuser credentials.
- Decide how Tetracorpus exposes unified timeline and search results without
  erasing source-specific detail.
- Prove a complete rebuild from Tigris into empty derived systems.
