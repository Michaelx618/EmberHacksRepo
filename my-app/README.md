# Recall

Turns handwritten notes into a knowledge graph that **reconciles what you
already know**, then tutors you in the way *you* learn.

Upload a photo of handwriting or an iPad PDF. One Gemini call transcribes it
and distills it into atomic concepts. Those concepts are reconciled against
your existing memory — reinforced, superseded, or flagged as contradicting
something you wrote earlier — then linked into a navigable graph. A tutor
grounded strictly in your own notes teaches from that graph, adapting its
style to how you ask and where you get stuck.

## Quick start

```bash
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

Phases of this app run **without an API key** — the seeded graph, all
navigation, retrieval, the learner model and mastery writeback all work
offline. To enable capture, real tutoring and fact-checking, put a key in
`my-app/.env.local`:

```
GEMINI_API_KEY=your-key-here
```

Get one at https://aistudio.google.com/apikey.

## The idea

**Storage appends. Memory reconciles.** When a new note covers ground you
already have, the app decides what actually happened:

| | |
|---|---|
| **reinforce** | Same idea restated. No new node — the existing concept gains a source and gets stronger. |
| **supersede** | Your understanding developed. The old explanation is kept as a revision, so you can watch your understanding evolve. |
| **contradict** | The two claims can't both be true. Both are kept, joined by a red edge. |
| **distinct** | The embedding was wrong; it's genuinely a new idea. |

That's why a concept is evidenced by *many* notes (`ConceptSource`), and why
re-reading a topic strengthens a node instead of duplicating it.

**Retrieval walks the graph.** Vector search finds seeds, then expands to
their 1-hop neighbours. That expansion is what lets the tutor notice you're
missing a *prerequisite* rather than only answering the question asked —
something plain vector RAG structurally cannot do.

**Memory fades.** `retrievability = mastery × exp(-Δdays / halfLife)`, where
repetition and active recall both extend the half-life. One formula drives
node colour, quiz targeting and spaced repetition at once.

**The tutor adapts.** A six-dimension style vector (abstraction, verbosity,
formalism, socratic, analogy, pace) updates every turn, and the system prompt
is *generated* from those numbers. Signals come from both the model and
heuristics on your wording, so the profile always moves. On repeated
confusion the tutor climbs an escalation ladder — rephrase, then a concrete
example, then an analogy built from concepts *you already know well*, then
dropping to the prerequisite.

## Layout

```
lib/
  memory.ts       consolidate() and retrieve() -- the write and read paths
  memory-math.ts  decay, mastery, thresholds (pure, unit-tested)
  learner.ts      style vector, prompt generation, heuristic signals
  vector.ts       cosine, topK, offline embedding stand-in
  gemini.ts       every Gemini call, each with an offline fallback
  graph-style.ts  node/edge visual encoding and level-of-detail
app/api/
  notes           upload -> OCR + extraction (ONE call) -> consolidate
  graph           nodes + links with all derived numbers precomputed
  concepts/[id]   inspector detail
  tutor           graph-grounded, style-adapted teaching
  quiz            generate from weakest concept, grade, write mastery back
  research        Google Search grounding -> a proposal you accept or reject
```

## Verification

```bash
npx tsx scripts/check-math.mts        # decay, cosine, prompt generation
npx tsx scripts/check-memory.mts      # consolidation: reinforce vs duplicate
npx tsx scripts/check-adaptation.mts  # style vector actually moves (dev server must be running)
```

`check-memory` contains the single most important assertion in the codebase:
re-reading a topic must produce **one** concept with `encounterCount: 2`, not
two concepts.

## Graph controls

| | |
|---|---|
| click | select — neighbours stay lit, everything else dims |
| right-click / `Enter` | enter a concept's local neighbourhood |
| `⌘K` | jump to any concept |
| arrows | walk between linked concepts |
| `Esc` | zoom back out |
| drag | pin a node in place |

Node **size** is degree, **fill** is recall strength, a **dashed ring** means
referenced but never defined, a **red ring** means it contradicts another
note, and a **badge** counts how many notes evidence it.
