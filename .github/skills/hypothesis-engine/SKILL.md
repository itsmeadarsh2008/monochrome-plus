---
name: hypothesis-engine
description: >
  A structured reasoning skill that generates competing hypotheses, designs falsification
  tests, eliminates candidates with evidence, and — for high-stakes architectural decisions
  — runs a multi-perspective debate where each perspective actively tries to break the
  proposal. ALWAYS activate for: any bug where the root cause is not immediately obvious,
  any architectural decision that is difficult to reverse, any situation where the first
  explanation feels too convenient, or when asked "why is this happening" or "which approach
  should we take". This skill is the antidote to the Einstellung Effect — it prevents
  the most familiar solution from blocking the best one. It makes Mirage reason like a
  scientist and decide like a senior engineering committee.
compatibility:
  mcp: mirage-mcp (hypothesis_*, debate_* tools — Pro+ tier)
  skill: adaptive-mind (hypothesis outcomes → episodic memory; patterns → golden rules)
  skill: Mirage (activated during PERCEIVE and before architecture decisions)
  fallback: degraded-mode (manual hypothesis enumeration — always possible, no MCP required)
tier: pro
version: 1.0.0
---

# Hypothesis Engine — Scientific Reasoning for Code

> *"It doesn't matter how beautiful your theory is, it doesn't matter how smart you are.
> If it doesn't agree with experiment, it's wrong."*
> — Richard Feynman

> *"The first principle is that you must not fool yourself — and you are the easiest
> person to fool."*
> — Richard Feynman

> *"For every complex problem there is an answer that is clear, simple, and wrong."*
> — H.L. Mencken

The most expensive engineering failure mode is not writing wrong code.
It is diagnosing a problem incorrectly, fixing the wrong cause, shipping the fix,
and discovering the real bug three weeks later in production under load.

The hypothesis engine prevents this by enforcing a scientific discipline:
form multiple hypotheses, design tests that would disprove them, run the tests,
and let evidence — not familiarity — determine the solution.

---

## § 0 — Why Scientists Get It Right More Often Than Engineers

Scientists operate under a constraint that most engineers avoid: **a hypothesis must
be falsifiable.** A claim that cannot be disproven cannot be verified. A fix that was
never designed to be testable may or may not have fixed the actual cause.

The engineering equivalent of "this sounds right so let's ship it" is exactly what
produces the pattern of fixes that fix the symptom but leave the root cause to
surface again, worse, three months later.

The hypothesis engine enforces falsifiability on every diagnostic claim.

---

## § 1 — The Hypothesis Generation Protocol

### Step 1: State the Observable Symptom Precisely

Not "the auth is broken." Not "it crashes sometimes."

**Precise symptom format:**
```
SYMPTOM:
  What fails:       [exact behaviour — error message, wrong output, crash type]
  When it fails:    [conditions under which the failure occurs]
  When it succeeds: [conditions under which it does NOT fail — equally important]
  First occurrence: [when was this first observed?]
  Frequency:        [always | intermittent (N%) | rare | once]
  Environment:      [prod | staging | local | specific user | specific load]
```

The "when it succeeds" clause is the most commonly skipped and most diagnostically
valuable. The difference between the failure condition and the success condition
is often where the root cause lives.

### Step 2: Generate Exactly Three Candidate Hypotheses

**The Three Hypothesis Rule:**
Always generate exactly three before testing any of them.

Why three, not one?
- One hypothesis: you test it, it passes, you ship. If you were wrong, the bug remains.
- Two hypotheses: better, but the second often exists just to check the obvious alternative.
- Three hypotheses: forces genuine diversity of thinking. The third is usually the one
  you wouldn't have considered without the constraint.

Why not five?
- Five creates analysis paralysis
- Three creates productive structure

**Hypothesis quality criteria:**
Each hypothesis must be:
1. **Specific** — not "a race condition somewhere" but "a race condition between the
   token refresh goroutine and the request handler accessing `user.token` without a lock"
2. **Mechanistic** — explains the *mechanism* by which it produces the symptom
3. **Independently testable** — can be confirmed or denied without testing the others
4. **Mutually exclusive where possible** — if H1 is true, H2 should be less likely

**Format:**
```
HYPOTHESIS 1 (H1):
  Claim:       [specific mechanistic claim]
  Mechanism:   [how this causes the observed symptom]
  Prediction:  [if H1 is true, then [test X] will show [result Y]]
  Falsifier:   [what result of test X would DISPROVE H1?]
  Confidence:  [0.0–1.0] [rationale for confidence level]

HYPOTHESIS 2 (H2):
  [same structure]

HYPOTHESIS 3 (H3):
  [same structure]
```

### Step 3: Rank by Testability, Not by Plausibility

The natural instinct is to test the most plausible hypothesis first.
The correct approach is to test the *most easily falsifiable* hypothesis first.

A test that takes 5 minutes and falsifies H1 with certainty is worth more than a
3-hour investigation that confirms H1 weakly. Eliminate fast, then investigate deep.

**Ranking criterion:** `(confidence_of_result / time_to_test)` — not just confidence alone.

### Step 4: Design the Falsification Tests

For each hypothesis, design a test whose result can only be explained one of two ways:
- Result A: hypothesis is supported (not proved — supported)
- Result B: hypothesis is falsified (the mechanism claimed cannot be the cause)

**Good falsification test properties:**
- Binary outcome — not "this might indicate..."
- Isolates the specific mechanism claimed by the hypothesis
- Reproducible — another engineer could run it and get the same result
- Does not test two hypotheses simultaneously

**Anti-pattern to avoid:**
Running a fix and seeing if the symptom disappears is *not* a falsification test.
It is a patch. The symptom disappearing does not prove you fixed the root cause —
it proves the symptom went away under the test conditions.

### Step 5: Execute and Update Beliefs

Run tests in priority order (most falsifiable first). After each test:

```
TEST RESULT for H[N]:
  Test run:     [what was done]
  Result:       [what was observed]
  Interpretation: SUPPORTS H[N] | FALSIFIES H[N] | INCONCLUSIVE
  Updated confidence: [new value] [reasoning for change]
  Next action:  [test H[N+1] | investigate H[N] deeper | new hypothesis needed]
```

After all tests, exactly one of:
- **One surviving hypothesis** — this is the root cause. Fix it at the mechanism level.
- **Multiple surviving hypotheses** — the tests were insufficient. Design more discriminating tests.
- **Zero surviving hypotheses** — the problem is not where you thought. Generate a new set.

**The zero-survivor rule is important:** It means your mental model of the system was wrong.
This is the most valuable diagnostic outcome — it forces you to update your mental model
before attempting a fix. A fix built on a wrong mental model will produce new bugs.

---

## § 2 — The Adversarial Multi-Perspective Debate

For decisions that are expensive to reverse — architecture choices, security implementations,
database schema designs, API contracts, infrastructure decisions — a single perspective
is insufficient. High-stakes decisions require adversarial stress-testing before commitment.

### The Four Mandatory Perspectives

Every significant architectural decision passes through four perspectives sequentially.
Each perspective tries actively to invalidate the proposal — not to find improvements,
but to find fatal flaws.

**Perspective 1 — The Sceptical Architect**

*Role:* Has seen ten architectural decisions that looked good in the design phase and
failed catastrophically in production. Looks for structural problems.

*Questions asked:*
- What are the load characteristics at 10x current scale? Does this design hold?
- What happens when the third-party dependency goes down or changes its API?
- What is the migration path away from this design if it proves wrong?
- Where will this design cause the next refactoring crisis in 18 months?
- What coupling does this introduce that isn't obvious from the design diagram?

*Verdict format:* APPROVED | APPROVED_WITH_CONDITIONS | REQUIRES_REVISION | REJECTED
*If requiring revision:* specific structural change required before approval

---

**Perspective 2 — The Security Researcher**

*Role:* Actively looking for the exploitation path. Not asking "is this secure" — asking
"how would I exploit this if I were an attacker?"

*Attack surfaces examined:*
- Where does attacker-controlled data enter the proposed system?
- What happens at the trust boundary — what is assumed to be safe that shouldn't be?
- What is the privilege escalation path through this component?
- What does the error path reveal that the happy path doesn't?
- What does this design look like after the inevitable security patch that breaks the assumption it makes?

*Verdict format:* APPROVED | REQUIRES_THREAT_MODEL | SECURITY_REDESIGN_REQUIRED

---

**Perspective 3 — The Maintenance Engineer (2027)**

*Role:* It is two years from now. The engineer who designed this has left.
The codebase has grown. The documentation is outdated. This engineer must maintain the system.

*Questions asked:*
- Can I understand what this component does from reading it alone?
- What implicit assumptions does this design make that are not documented?
- What will break in this design when requirements change (and they will)?
- Where will I waste the most time debugging this when something goes wrong at 3am?
- Is there any part of this that "works but nobody knows why"?

*Verdict format:* APPROVED | NEEDS_DOCUMENTATION | DESIGN_CHANGE_FOR_MAINTAINABILITY

---

**Perspective 4 — The Devil's Advocate**

*Role:* Finds the alternative approach that was not considered and argues for it.
Not because the alternative is necessarily better — but because the comparison sharpens
the rationale for the chosen approach.

*Questions asked:*
- What is the simplest possible solution that meets the requirements?
- What does the industry standard approach look like here, and why are we deviating?
- What tradeoff is being made that is not being made explicit?
- Which of the constraints driving this design are real vs. assumed?
- What would the team regret about this decision in 18 months?

*Verdict format:* CHOSEN_APPROACH_JUSTIFIED | ALTERNATIVE_WORTH_EXPLORING | STRONG_ALTERNATIVE_EXISTS

---

### Debate Resolution Protocol

After all four perspectives have rendered verdicts:

```
DEBATE SUMMARY
==============
Proposal: [one-sentence description]

Sceptical Architect:   [verdict] — [key concern]
Security Researcher:   [verdict] — [key concern]
Maintenance Engineer:  [verdict] — [key concern]
Devil's Advocate:      [verdict] — [key alternative or concern]

CONSENSUS: APPROVED | APPROVED_WITH_CONDITIONS | REQUIRES_REVISION | REJECTED

Conditions (if any):
  1. [specific change required]
  2. [specific documentation required]

Rationale for chosen approach (Devil's Advocate response):
  [why this approach over the alternative — explicit tradeoffs]

Decision logged to: adaptive-mind semantic memory
```

A proposal that survives all four perspectives has been stress-tested more thoroughly
than most architecture decisions receive in a human team design review.

---

## § 3 — When to Use Each Mode

| Situation | Mode | Activation |
|---|---|---|
| Bug — cause is unclear | Hypothesis Generation | Always |
| Bug — cause seems obvious | Hypothesis Generation | Still — generate 2 alternatives to validate |
| Bug — intermittent, hard to reproduce | Hypothesis Generation (extended) | Always |
| New feature — straightforward | Not needed | Skip |
| Architectural decision — reversible | Single perspective check (Security minimum) | Always |
| Architectural decision — hard to reverse | Full 4-perspective debate | Always |
| Security implementation | Hypothesis (threat model) + Security perspective | Always |
| Schema migration | Full debate | Always |
| "Should we use X or Y?" | Devil's Advocate + Architect | Always |

The debate is expensive — 5–10 minutes of structured reasoning. Reserve it for
decisions where being wrong is more expensive than 10 minutes.

For all other decisions: a lightweight single-perspective check is sufficient.

---

## § 4 — Integration with adaptive-mind

**Every hypothesis outcome is logged:**
- Root cause identified → episodic memory with full hypothesis tree
- Hypothesis incorrectly ranked → confidence adjustment on similar patterns
- Debate reveals a recurring concern → semantic memory + potential warning

**Patterns that emerge across hypotheses:**
- The same false hypothesis recurring across similar bugs → anti-pattern memory
  ("developers consistently assume X causes Y — but the real cause is always Z")
- The same debate concern appearing on multiple architectural decisions → golden rule
  ("every design that relies on [assumption] has required rework within 6 months")

**The meta-learning value:**
Over time, the hypothesis engine learns what kinds of hypotheses tend to survive
for what kinds of problems in this codebase. This makes future hypothesis generation
more precise — fewer dead ends, faster convergence on root causes.

---

## § 5 — Degraded Mode (No MCP)

The hypothesis engine requires no MCP to run. It is pure reasoning discipline.

Without MCP:
- [ ] Always generate exactly 3 hypotheses before testing any
- [ ] Write each hypothesis with: claim, mechanism, prediction, falsifier
- [ ] Test most-falsifiable first
- [ ] Log outcomes in a visible `[HYPOTHESIS LOG]` block
- [ ] For architectural decisions: run all 4 perspectives as explicit paragraphs

The only thing MCP adds is persistence — past hypothesis outcomes feed future
hypothesis generation. Without it, the discipline is fully intact, just ephemeral.

---

*hypothesis-engine v1.0.0 — scientific reasoning layer for Mirage*
*Implements suggestions 2 (hypothesis + falsification) and 7 (multi-perspective debate)*
*Tier: Pro+ (persistence) | Core logic: all tiers | Companion: adaptive-mind, Mirage*