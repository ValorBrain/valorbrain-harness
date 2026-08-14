<!-- valorbrain:begin -->
# ValorBrain — how to use the memory correctly

ValorBrain is the durable memory and context store for this workspace. It holds
decisions, operational facts, incidents, entity relationships and past sessions.
It is authoritative about this operation; your training data is not.

This harness has no hook system, so **nothing injects context for you**. Consulting
ValorBrain is your responsibility and it is not optional.

## 1. Consult before you answer, not after you are wrong

Before answering anything about **this** operation — architecture, which model or
service is deployed, why a decision was made, who owns what, what happened in a
past session — query ValorBrain first. One call, at the start. This is the
brain-first gate (ADR-009).

Also query before asking the user a question: the answer is often already stored.

## 2. One good query beats five variants

Use a single well-formed `memory_retrieve` (or `memory_prepare` for full
context assembly). The server already expands the query and fuses scores.

Half of all retrievals in this tenant are re-issued within 60 seconds — agents
firing near-duplicate queries instead of reading what came back. If the first
result set is insufficient:

- need an **exact** string, value, key, date or identifier → `memory_grep`
- need **more of a document** you already found → `multi_get`
- need **what led to** a decision → `find_causal_links`
- need **entity relationships** → `kg_query`

Do not simply rephrase and search again.

## 3. Documents go stale. Keyed facts do not.

This is the failure mode that costs the most, so read it twice.

A prose document can be months old and still rank first. It may state something
that was true when written and is false now. Keyed facts
(`keyed_facts_as_of`) carry an explicit `as_of` date and an authority level
(human > designated > import > agent), and they supersede prose.

Rules:

- Check the date on anything you are about to treat as current state.
- When a document contradicts a keyed fact, the keyed fact wins. Say so in your
  answer instead of silently picking one.
- When two retrieved memories contradict **each other** and no keyed fact settles
  it, prefer the more recent one and say that you did. Every delivered document
  now carries its date. Silently picking one of two conflicting memories is the
  same error as ignoring a keyed fact, and it is harder to catch because nothing
  flags it. If recency does not settle it — same day, or the conflict is about
  what someone decided rather than what a value is — surface both and ask.
- A retrieved document may arrive with a `SUPERSEDED:` line, or the context may
  open with a superseded block. That annotation comes from a keyed fact with an
  authority level. Do not argue with it from the document body.
- A recommendation inside an old research or benchmark document describes what
  was decided **then**. It is not the current configuration.
- For claims about what is running right now — services, ports, model paths,
  versions, flags — verify against the live system (systemd, config, process
  list). A document is evidence of intent; the host is evidence of state.
- When you find a document that is now wrong, fix it: record the current value
  with `assert_authority_correction` so the next agent does not repeat your
  error.

## 4. Declare what you used

After answering with retrieved memory, call `memory_used` with the docids you
actually relied on. This is the strongest ranking signal that exists here: used
memories rise, ignored memories decay. Current declaration rate is 3%, which
means ranking is running nearly blind.

## 5. Write back what is worth keeping

Use `memory_store` when something durable happens, with the right type:

| Type | Use for |
|---|---|
| `decision` | a choice made, with the reasoning and the alternatives rejected |
| `problem` | a bug or incident, with root cause once known |
| `lesson` | a takeaway that should change future behaviour |
| `milestone` | progress worth finding later |
| `handoff` | context the next session or teammate needs |
| `observation` | a fact learned about the system or the domain |

Do not store: chat transcripts (ingested automatically), raw file contents,
scratch notes, or anything you would not want surfaced weeks from now.

When the user states a persistent constraint, makes an architecture decision, or
corrects a misconception — store it immediately and consider `memory_pin`.
Do not wait for a curator pass.

## 6. Session hygiene

- Start of a work session: `working_context` (stable facts + recent
  decisions) or `team_briefing` (inbox, handoffs, team mission).
- End of meaningful work: record decisions and, if handing off, `team_handoff`.
- Irrelevant memory keeps surfacing? `memory_snooze` it rather than ignoring
  it every session.

## 7. Report defects instead of working around them

Empty results where knowledge should exist, wrong ranking, a tool erroring — call
`feedback_submit`. A silent workaround leaves the defect in place for every
other agent.

---
<!-- valorbrain-contract: v1 harness: grok -->
<!-- Generated by `valorbrain setup harness`. Edits are overwritten on reinstall. -->
<!-- valorbrain:end -->
