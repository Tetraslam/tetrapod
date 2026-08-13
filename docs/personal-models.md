# Personal Models

Personal models are models trained, fine-tuned, or continually adapted using
Shresht's data. Their weights are owned by Shresht even when training or
inference runs on Modal or another provider. They complement agents with
measurable learned signals; they are not a new name for Tetracorpus, retrieval,
prompt context, or ordinary agent behavior.

This is an open research program rather than one planned model. The list below
records plausible directions, not commitments to implement every model. No
personal-model implementation work has started.

## Immediately Compelling Directions

The following directions currently stand out. This is a shortlist for future
attention, not a claim that the remaining model ideas are rejected:

- domain rankers
- aesthetic reward models
- contextual bandits
- context-change detection
- cash-flow forecasting
- spending-regime modeling
- relationship-maintenance modeling
- writing-voice models
- personal text detectors
- multi-register writing models
- personal rewrite models
- autobiographical narrative models
- diffusion adapters
- personal voice models

## Principles

- Prefer predictive quality over interpretability in general, while evaluating
  the tradeoff per application.
- Use context because Shresht deliberately changes his routines and environment
  often; stationary averages will frequently be wrong.
- Bias deployed models toward current behavior. Preserve old checkpoints for
  history and experiments rather than letting adolescent data dominate current
  predictions.
- Collect explicit labels and periodic self-reports where they add information
  unavailable from passive behavior.
- Own model weights and training artifacts. Local execution is optional.
- Compare trained models with strong in-context agent baselines instead of
  assuming either paradigm wins.
- Training from scratch can be a worthwhile research goal even when fine-tuning
  performs better. Useful systems may pursue both.
- Sensitive predictions are allowed in principle. Restrictions should be tied
  to concrete harms or actions rather than discomfort with inference itself.

## What Training Adds Beyond Agents

Agents can search Tetracorpus and generalize from a handful of examples
immediately. That makes pure retrieval personalization less interesting by
itself. Trained models become interesting when they offer one or more of:

- cheap scoring over millions of candidates or time steps
- calibrated numerical predictions
- consistent behavior that can be evaluated over time
- latent features agents cannot derive reliably in every prompt
- continual adaptation from passive outcomes
- generation in a personal style without supplying a large history each time
- simulation of likely choices under many hypothetical scenarios
- compact representations that transfer across downstream tasks
- novel models and training results worth studying for their own sake

## Preference And Value Models

These overlap with Curator but can serve any agent or application.

### Domain Rankers

Separate pairwise or listwise models for movies, television, anime, manga,
papers, events, software, products, NSFW material, and YouTube videos. They rank
large candidate pools using explicit comparisons and behavioral outcomes.

### General Personal Reward Model

A model trained on pairs of plans, recommendations, messages, designs, code
changes, purchases, and generated outputs. It predicts which result Shresht
would prefer. Agents can use it for best-of-N selection, search, reinforcement
learning, or critique.

### Aesthetic Reward Models

Models for images, UI designs, illustrations, 3D renders, music, prose, and
other creative artifacts. Pairwise comparisons are particularly useful because
stated aesthetic rules often fail to predict revealed preference. A creative
writing study found a personalized encoder could reach useful accuracy with as
few as 15 revealed comparisons and outperform frontier-model prompting with
larger personal datasets.

### Effort-To-Value Model

Predict whether a candidate activity, purchase, event, project, or piece of
media will repay its time, money, and attention cost. This differs from liking:
a paper may be valuable without being pleasant, and a show may be enjoyable but
not worth starting now.

### Notification Value Model

Predict whether surfacing an item now is better than acting silently, waiting,
or never interrupting. Training labels distinguish item quality from timing and
interruption cost.

### Personal Tradeoff Model

Learn choices among speed, quality, money, privacy, control, social cost, and
future optionality from real decisions. Agents can query it when many solutions
are valid but differ along dimensions that generic reward models average away.

### Contextual Bandit Policies

Choose candidates and actions while balancing known preferences with deliberate
exploration. Separate policies can optimize media discovery, event suggestions,
or feedback questions. Offline replay and agent-only baselines help prevent the
policy from learning clickbait or convenience rather than lasting value.

## Behavioral And Temporal Models

These predict what is likely to happen rather than pretending routines are
fixed traits.

### Next-Activity Model

Predict the next application, task category, place, media activity, purchase,
or communication mode from recent context. Useful to prefetch context, prepare
tools, or help agents anticipate the next state.

### Routine Distribution Model

Model distributions over days rather than one canonical routine. Inputs include
calendar, location, recent travel, active pursuits, sleep, social plans, and
device activity. It can answer, "What normally follows this kind of day?" while
remaining uncertain during novel periods.

### Plan Feasibility And Completion Model

Predict whether a proposed schedule, commitment, or personal plan will actually
fit the current week and which part is likely to fail. Train on calendars,
stated plans, task completion, travel, and later outcomes.

### Duration And Delay Model

Predict how long personal tasks, errands, travel, reviews, experiments, and
responses take for Shresht under current conditions. Agents can produce more
realistic plans and know when silence is unusual.

### Context-Change Detector

Detect regime changes such as travel, a new job phase, changed living situation,
new relationship, illness, intense project period, or altered sleep schedule.
Other models use the detected regime to downweight stale history and adapt
quickly.

### Personal State-Space Model

Learn a low-dimensional latent state evolving through time from heterogeneous
events. The state may capture unlabelled modes useful for many forecasts without
claiming they are permanent personality traits. Downstream heads can predict
sleep, spending, activity, or recommendation response from the shared state.

### Event Hazard Models

Estimate time-to-event distributions: when a subscription will be canceled,
when equipment will be replaced, when a pursuit will need steering, when a
friend will likely be contacted again, or when travel is likely. Survival models
handle censored and irregular histories better than naive classification.

### Anomaly Models

Learn personal baselines and flag unusual sleep, spending, location, account
activity, social withdrawal, service use, or infrastructure behavior. Personal
anomalies are more useful than generic thresholds when normal behavior varies
widely between people.

## Health And Physiology Models

Health models should combine passive data with explicit self-reports and use
chronological evaluation. Research on personalized digital health finds that
simple personal MLPs can outperform more complex models in low-data regimes,
and that carefully weighted data from other people can improve loneliness,
affect, glucose, and sleep predictions.

### Sleep Forecasting

Predict sleep onset, duration, efficiency, stages, disturbances, and next-day
effects using Eight Sleep, activity, calendar, meals, location, media, travel,
room conditions, and prior sleep.

### Energy And Focus Forecasting

Predict usable focus, fatigue, or likelihood of deep work over the next hours.
Labels can combine short self-reports with computer activity and task outcomes.

### Affect And Stress Models

Forecast positive affect, negative affect, stress, or loneliness from sleep,
communication, location, activity, calendar, and explicit momentary labels.
These models can provide context to agents without treating a prediction as a
diagnosis.

### Personal Intervention Model

Estimate heterogeneous treatment effects: whether sleep timing, exercise,
caffeine, food, breaks, social activity, or environment changes improve a later
outcome for Shresht. This is more useful than a correlational dashboard but
requires deliberate experiments or careful causal assumptions.

### Food And Glucose Response Model

If relevant sensor data becomes available, predict energy, sleep, or glucose
response to meals in personal context. Even without a CGM, subjective outcomes
and Eight Sleep can support narrower experiments.

### Symptom And Illness Detector

Detect early deviations associated with illness or recovery from sleep,
temperature, heart rate, activity, purchases, and device behavior. It should
report uncertainty and evidence because false alarms have different costs from
ordinary recommendation errors.

## Financial And Consumption Models

### Cash-Flow Forecasting

Predict account balances and spending distributions from Mercury, recurring
payments, calendar, travel, orders, and upcoming commitments. Unlike a static
budget, it can condition on known changes.

### Purchase Utility Model

Predict whether an item will be used, enjoyed, retained, returned, or regretted.
Train from orders, returns, repeated use where observable, explicit feedback,
and similar prior purchases.

### Subscription Value Model

Estimate future usage and value of subscriptions from actual behavior. It can
identify subscriptions likely to become worthwhile again rather than simply
flagging every low-use month.

### Price And Timing Model

Predict whether waiting is likely to improve price or utility for personally
relevant products, travel, and tickets. Public market features combine with the
personal cost of delay.

### Spending Regime Model

Forecast how travel, moves, work phases, relationships, and active hobbies alter
category spending. This helps agents avoid treating an intentional life change
as anomalous overspending.

## Mobility, Place, And Event Models

### Destination And Route Model

Predict likely next destinations and preferred transport under current time,
weather, calendar, companions, and recent behavior. This can prefetch routes or
support private social coordination.

### Travel Friction Model

Predict the true personal cost of an event or errand, including preparation,
transfers, delays, return time, and likely fatigue. Event Curator can rank events
by expected total value rather than title relevance alone.

### Place Affinity Model

Learn which places work well for specific activities such as focused work,
socializing, eating, shopping, or recovery. It can generalize to unseen places
from attributes and context.

### Location Uncertainty Model

Fuse noisy observations from devices and services into a calibrated location
distribution without pretending every sample is exact. Downstream systems can
choose privacy and action thresholds appropriate to their use.

## Social And Relationship Models

These model interaction dynamics, not people's moral worth.

### Contact Timing Model

Predict when contacting someone is likely to be welcome or useful from mutual
history, calendars, time zones, recent interaction, and current context.

### Relationship Maintenance Model

Estimate which relationships are drifting unintentionally versus following a
normal sparse cadence. It can suggest opportunities without converting friends
into a CRM leaderboard.

### Communication Medium Model

Predict whether a person and context call for Discord, Signal, text, email, a
call, or an in-person plan, as well as likely response delay.

### Social Opportunity Model

Score opportunities such as nearby presence, shared event interest, overlapping
travel, or complementary pursuits. This can become a learned component of the
private social coordination system.

### Interaction Outcome Model

Predict whether a proposed invitation, introduction, collaboration, or message
is likely to produce the intended outcome. Agents can compare alternative timing
and wording while leaving the actual social decision to Shresht.

## Models Of Shresht

### Writing-Voice Model

Fine-tune a language model or adapter to reproduce Shresht's tone across chat,
technical writing, email, reviews, fiction, and other genres. Context or control
tokens should select the relevant register rather than averaging them into one
voice. Uses include drafting, rewriting generic agent prose, generating messages
for approval, and testing whether a text sounds like him.

### Personal Text Detector

Train the inverse model: score whether text sounds like Shresht and identify
where it departs. This can act as a reward model for best-of-N generation and
may be easier to evaluate than end-to-end imitation.

### Decision Emulator

Given a concrete situation and options, predict Shresht's choice and confidence.
Agents can use it to simulate low-stakes decisions or identify cases where the
emulator is uncertain enough to ask.

### Response Simulator

Predict how Shresht would react to a recommendation, notification, design,
argument, or message. Curator and Tetrarium can evaluate candidate outputs in
bulk before involving him.

### Annotation And Critique Model

Generate the kinds of review comments Shresht would make on code, research,
design, or prose. Unlike pure tone imitation, it learns what he notices and what
changes he values.

### Personal Reward And Policy Models

Use Shresht's comparisons to train reward models, then optimize a model or agent
policy against them. This can personalize output selection more deeply than a
style fine-tune while preserving a separate general base model.

### Digital Twin For Counterfactuals

Simulate likely choices or reactions under hypothetical schedules, purchases,
messages, moves, and projects. Its value is scenario comparison, not claiming
to be a conscious copy or authoritative substitute.

## Generative Models Trained On Personal Data

Fine-tuned LLMs are one obvious example, but personal generative models can do
more than answer in a preferred tone.

### Multi-Register Writing Model

Generate in distinct learned registers: casual chat, concise agent direction,
technical explanation, research prose, worldbuilding, fiction, reviews, and
public writing. A retrieval-conditioned adapter can use current facts while the
weights learn voice and habitual structure.

### Personal Rewrite Model

Transform generic or agent-written text into something Shresht would actually
send, preserving meaning while removing verbosity, fake contrast, management
jargon, and other disliked habits.

### Autobiographical Narrative Model

Generate journals, timelines, travelogues, yearly retrospectives, or accounts of
a pursuit from Tetracorpus evidence. The model learns narrative selection and
voice while retrieval grounds factual details.

### Personal Dreaming Model

Generate surprising connections, project seeds, media combinations, or creative
directions from distant parts of Tetracorpus. Unlike retrieval, the objective is
novel recombination that still predicts personal interest.

### Personal Worldbuilding Model

Fine-tune on Shresht's worldbuilding, conlangs, aesthetic preferences, accepted
ideas, and revisions. It can generate material consistent with existing worlds
or create new systems in the same deeper taste without copying surface motifs.

### Personal Code Model

Adapt a code model to repository conventions, architecture choices, review
preferences, toolchain use, and recurring implementation patterns. Its value
must be tested against agents supplied with `AGENTS.md`; style imitation alone
is not enough.

### Personal UI Generator

Generate interface structures and visual systems conditioned on prior accepted
and rejected designs. A separate aesthetic reward model can rank outputs before
an agent implements and verifies them.

### Personal Image Or Diffusion Adapter

Train LoRAs or adapters on selected images, art preferences, worldbuilding, and
pairwise judgments. Possible outputs include private visual worlds, characters,
design references, wallpapers, or imagery aligned with personal aesthetics.

### Personal Music Model

Train or adapt a symbolic, audio-token, or embedding-conditioned music model on
listening history, explicit comparisons, compositions, and context. It could
generate music for current activity or develop ideas related to SHFLA rather
than merely imitate favorite artists.

### Personal Voice Model

With deliberately collected recordings, train speech synthesis for private
drafting, accessibility, characters, or agent interfaces. This has obvious
impersonation risk outside controlled use and should never be exposed as an
unrestricted public capability.

### Personal Media Editor

Learn which moments, pacing, crops, captions, music, and sequencing Shresht
prefers, then generate photo albums, video edits, or event recaps from personal
media and context.

### Future-Self Conversation Models

Preserve selected historical checkpoints of writing and decisions, then train
or condition models that approximate past periods. These are useful for
reflection and longitudinal experiments. Current systems should still weight
recent behavior by default.

## Learned Representations

Tetracorpus itself is the factual substrate. A learned representation is useful
only if it compresses patterns that improve downstream predictions.

### Dynamic User Embedding

Encode recent and long-term behavior into separate vectors. A downstream query
or task attends to both stable tendencies and current intent. Recent work shows
that this split can outperform stuffing raw histories into an LLM prompt across
classification and personalized generation tasks.

### Personal Event Embeddings

Train contrastive embeddings where events with similar personal meaning are
nearby even when their source formats differ. Examples include a saved paper, a
GitHub session, and a calendar event belonging to the same pursuit.

### Personal Concept Codebook

Learn reusable latent prototypes from events, then represent current context as
a mixture of prototypes. This offers an interesting trainable alternative to a
handwritten persona and can adapt without defining contexts in advance.

### Multitask Personal Encoder

Train one temporal encoder with many prediction heads: next activity, sleep,
spending, recommendation response, location, and affect. Shared representations
may make small personal datasets more useful, while ablations reveal whether
the tasks genuinely help one another.

## Continual Learning And Time

Personal models should not average all years equally. Useful mechanisms include:

- time-decayed sample weights
- recent-data fine-tuning with replay from older periods
- adapters or checkpoints per life regime
- change-point detection followed by rapid adaptation
- ensembles of current and historical models
- temporal features supplied explicitly at inference
- evaluations that train on the past and test on the future

Keeping historical checkpoints is cheap relative to collecting the data and
allows experiments on how preferences, style, and behavior changed. A deployed
model should normally optimize for the current Shresht unless a historical
perspective is requested.

## Explicit Data Collection

Useful active labels include:

- pairwise preferences between recommendations or generated outputs
- short reason tags when a choice is surprising
- quick energy, mood, stress, and focus reports
- whether a recommendation was good but badly timed
- expected versus actual value after an event, purchase, or media item
- counterfactual choice questions for decision models
- edits to generated messages and prose
- periodic statements about major context or goal changes

Label requests should be selected for information value and kept lightweight.
Contextual bandits and active-learning models can eventually choose which one
question would improve a model most.

## Sensitive Inference

Examples of sensitive predictions include:

- health conditions, mental state, substance use, or illness
- sexual interests or behavior
- relationship strength, conflict, attraction, or likely breakup
- exact location, home absence, or future travel
- financial distress, income, account balances, or purchase susceptibility
- political or religious beliefs
- private communications or likely responses from other people
- identity attributes not explicitly provided
- vulnerabilities that could be used for manipulation

These inferences are acceptable for private use. The concrete risks are
incorrect high-impact action, exposure to another person or public service, and
manipulative optimization. Permissions and action policies should become
stricter when predictions can move money, contact others, affect healthcare,
reveal secrets, or influence a person without their knowledge.

## Direct Action

Most personal models should expose predictions, scores, uncertainty, embeddings,
or generated candidates to agents. Direct action is usually an agent or policy
tool concern.

Exceptions could include low-level systems whose action space is narrow and
reversible: prefetching context, choosing notification timing, adjusting a media
queue, selecting an experiment arm, or asking a high-information feedback
question. Even then, the deployed component is better understood as a policy
using personal models than as an unconstrained model acting alone.

## Evaluation

- Split chronologically and test on genuinely future behavior.
- Compare against population models, simple personal baselines, retrieval, and
  frontier agents with in-context history.
- Measure calibration when scores affect actions.
- Evaluate after known life changes, not only during stable periods.
- Separate item quality from timing, convenience, and action outcomes.
- Keep ablations small enough to learn whether personal data actually helps.
- Record model, dataset, code, metrics, and weights for reproducibility.

## Research Leads

Relevant recent directions include:

- **General User Models from computer use:** confidence-weighted propositions
  inferred and revised over time, used for proactive assistants and context.
- **Continuous user representations:** stable and query-specific learned user
  embeddings that personalize generation without placing all history in context.
- **Longitudinal sensor personas:** continually updated representations that
  distinguish recurring behavior from temporary episodes.
- **Personalized digital health:** chronological personal forecasting using
  target-user data plus adaptively selected support users.
- **Literary preference models:** revealed pairwise preferences outperform stated
  profiles, and small supervised personal models can beat frontier prompting.

## Questions For Later

- Which model family becomes the first Tetrarium pursuit once data exists?
- Which outcomes are valuable enough to collect explicit labels now?
- Which public or multi-user datasets can pretrain models before personal data is
  abundant?
- Which models benefit from one shared personal encoder versus independent
  domain-specific training?
- How should agents decide when to trust a personal model over their own
  contextual reasoning?
