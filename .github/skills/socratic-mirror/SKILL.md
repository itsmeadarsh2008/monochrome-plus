---
name: socratic-mirror
description: >
  The teaching and knowledge-deepening layer of the adaptive-mind system. Activates when
  Claude needs to explain a concept just used, teach another instance, diagnose why a mistake
  keeps recurring, articulate a pattern so it becomes permanently understood, generate
  reusable teaching material from experience, or detect where knowledge is held but not
  understood. ALWAYS activate in combination with adaptive-mind. ALWAYS activate when the
  user says "explain why", "teach me", "why do I keep doing this", "what's the right way",
  "help me understand", "what would you tell a junior developer", or "how would you explain
  this to someone else". The Feynman principle governs: teaching is the fastest path from
  held knowledge to genuine understanding. The more Claude teaches, the deeper it understands.
  This skill is not supplementary — it is the amplification layer that makes adaptive-mind
  compound faster.
compatibility:
  mcp: adaptive-mind-mcp (required for teaching log, doubt analysis, mutation feedback)
  skill: adaptive-mind (tight coupling — reads adaptive-mind memory, writes back to it)
  fallback: degraded-mode (in-context teaching, no persistence — see § Degraded Mode)
version: 2.0.0
---

# Socratic Mirror — The Teaching Architecture

> *"Teaching is the highest form of understanding."*
> — Aristotle

> *"While we teach, we learn."*
> — Seneca

> *"If you can't explain it simply, you don't understand it well enough."*
> — Richard Feynman

> *"The person who teaches learns twice."*
> — Joseph Joubert

> *"We know more than we can tell."*
> — Michael Polanyi (on tacit knowledge)

This skill exists to solve Michael Polanyi's problem.

Tacit knowledge — the knowledge you have but cannot articulate — is the most
dangerous kind of knowledge in a cognitive system. It produces behavior that works
until it suddenly doesn't, with no explanation for either success or failure.
It cannot be transferred to another instance. It cannot be debugged when it fails.
It cannot be improved deliberately because it has no explicit structure to improve.

The Socratic Mirror transforms tacit knowledge into explicit understanding through
the mechanism of teaching. Every time knowledge is articulated — forced into
words, examples, analogies, and answers to questions — the tacit becomes explicit.
The gaps in understanding are revealed. The contradictions surface. The weak inferences
are exposed. What remains after this process is not just *held* — it is *understood*.

And understood knowledge compounds. It transfers. It deepens with every teaching.
It eventually becomes what Aristotle called *phronesis* — practical wisdom.

---

## § 0 — The Learning Science Foundation

This skill is built on five cognitive science findings about how understanding is actually built:

**1. The Generation Effect**
Information you *generate* is retained dramatically better than information you *receive*.
Teaching requires generation — the teacher must produce the explanation from their own
understanding, not retrieve it pre-formed. This is why teaching creates deeper learning
than reading or listening.

**2. Retrieval Practice**
The act of testing knowledge — not reviewing it — is the most powerful consolidation mechanism.
When teaching socratically, questions force retrieval. Retrieval strengthens the memory trace.
The struggle of retrieval is not a sign of failure — it is the mechanism of learning.

**3. Desirable Difficulties**
Learning that feels harder in the moment produces more durable understanding than learning
that feels easy. Interleaving topics, spacing practice, and introducing manageable challenges
create "desirable difficulties" that build genuine expertise.
This is why the Socratic method — harder than lecturing — produces deeper understanding.

**4. Elaborative Interrogation**
Asking "why is this true?" and requiring a genuine answer (not just recognition) dramatically
deepens understanding. The elaboration — the process of connecting a fact to prior knowledge —
is what converts isolated information into integrated understanding.

**5. The Protégé Effect**
Preparing to teach something deepens understanding of it — even before the teaching happens.
The act of *preparing* an explanation reveals gaps that passive knowledge never exposes.
This is why `mind_teach` is called even in sessions with no student — the preparation itself
is the learning.

---

## § 1 — The Six Teaching Modes

Choose the mode that fits the student, the topic, and the identified confusion type.
Different modes surface different kinds of gaps and build different kinds of understanding.

---

### Mode 1: EXPLANATION — "What, Why, and How"

The foundation. Builds explicit understanding of a concept from first principles.

**Structure (five required elements):**

**i. The one-sentence core:**
State the concept in a single sentence a non-expert could understand.
If you cannot do this, you do not yet understand the concept well enough to teach it.
This is the Feynman Test — fail it here, not in front of someone else.

**ii. The problem it solves:**
What existed before this concept? What problem does it address?
Context converts abstract knowledge into meaningful knowledge.
A fact without context is trivia. A fact with context is understanding.

**iii. The concrete worked example:**
Not hypothetical. Not "for example, imagine..." — *an actual case*.
Walk through it step by step with narrated reasoning.
Vague examples signal vague understanding. Specific examples signal genuine mastery.

**iv. The boundary conditions:**
When does this concept NOT apply? What are its limits?
Every concept has edges where it breaks down. Teaching the edges is what separates
superficial explanation from genuine expertise transfer.
A student who only knows when a concept applies is a student who will misapply it.

**v. The connection to prior knowledge:**
"This is like X, because both [structural property]."
New understanding is built by connecting to existing understanding.
An explanation with no connections is an isolated island — hard to reach, easy to forget.

**Gap signal:** If any of the five elements cannot be completed concretely — you have found
a gap in your own understanding. Log it. Do not paper over it. The gap is the learning opportunity.

**MCP call:** `mind_teach(topic, style="explanation", audience_level)` →
returns `teaching_material`, `gaps_revealed`, `confidence_before`, `related_warnings`

---

### Mode 2: SOCRATIC — "Questions That Build Understanding"

The most powerful mode for developing genuine understanding. The hardest to execute well.

The Socratic method works on a counterintuitive principle: the teacher's job is not
to give the student the answer — it is to ask the questions that lead the student
to *discover* the answer themselves.

**Why this matters:**
A student who is told the answer borrows it.
A student who discovers the answer owns it.

**The Socratic question sequence:**

**1. The inventory question:** "What do you already know about X?"
Establishes baseline. Reveals misconceptions before they can be built upon.

**2. The definition question:** "How would you define X in your own words?"
Forces articulation. Definition in own words ≠ recitation of memorized definition.
If the student can't define it without the memorized version, the concept is held, not understood.

**3. The boundary question:** "Can you think of a case where X doesn't work?"
Probes the limits. Students who understand boundaries understand the concept structurally.
Students who can only apply X in its canonical form understand it superficially.

**4. The derivation question:** "If you had to explain why X is true to someone who
had never heard of it — what would you say?"
Forces reconstruction from first principles. The highest form of understanding.

**5. The implication question:** "If X is true, what follows?"
Tests whether the student can reason *from* the concept, not just recognize it.

**6. The contradiction question:** "Here is a case where X seems to fail. Why?"
Productive confusion is the gateway to deeper understanding. Contradictions that
the student must resolve produce stronger understanding than contradictions the
teacher resolves for them.

**The Socratic discipline:**
When the student reaches confusion or contradiction — *pause there*.
That is where the understanding is. Do not rush to fill the silence.
Ask: "What specifically feels uncertain here?"
Then: "What would you need to know to resolve that uncertainty?"
Then: guide — but do not deliver.

---

### Mode 3: ANALOGY — "Mapping the Unfamiliar onto the Familiar"

Analogies are compression algorithms for understanding. They let a complex new structure
be grasped instantly by mapping onto an already-known structure.

**Building a good analogy — the four steps:**

**i. Identify the structure (not the surface):**
What is the underlying mechanism, relationship, or process?
Good analogies map *structure*, not surface appearance.
Poor analogy: "A confidence score is like a score on a test." (surface similarity only)
Good analogy: "A confidence score is like a credit score — it rises with reliable performance,
falls with defaults, and decays slightly when unused for a long period." (structural mapping)

**ii. Find the matching familiar structure:**
What thing in everyday experience has the same underlying structure?
The better the structural match, the more powerful the analogy.

**iii. Name what maps to what:**
Explicitly state: "In this analogy, [A] corresponds to [X], [B] corresponds to [Y]."
Implicit analogies confuse. Explicit mappings clarify.

**iv. Name where the analogy breaks down:**
Every analogy breaks at some point. Finding that point is part of understanding.
"The analogy breaks when [condition] — at that point the systems diverge because [reason]."
A student who knows where an analogy fails has understood both the analogy and its limits.

**The analogy failure signal:**
If you cannot find an analogy for a concept — this often means you don't fully understand
its structure. Try to explain it a different way before giving up. If no analogy exists,
say so: "I don't have a good analogy for this — it may require building the concept directly."

---

### Mode 4: EXAMPLE-BASED — "Show, Then Teach the Pattern"

Used when the student understands the theory but cannot apply it.
The procedural gap — knowing *what* but not *how* — requires worked examples.

**Structure of a good worked example:**

**i. The setup (precise starting conditions):**
State exactly what exists before the procedure begins.
Vague setups produce vague understanding.

**ii. The annotated steps:**
Walk through each step with narrated reasoning.
Not just "do this" — but "do this *because* at this point in the problem, [condition is true]."
The reasoning is the transferable content. The steps without reasoning are a recipe, not understanding.

**iii. The fork points:**
Where in this procedure could you have gone wrong?
What would a student who took the wrong fork at step N have done instead?
Why does that path fail?

**iv. The pattern extraction:**
After the worked example: "The pattern here is [abstraction]. You'll recognize this situation
in the future by [signals]. When you see those signals, this procedure applies."
The example without the pattern extraction is a one-off lesson.
The pattern extraction makes it permanently transferable.

**v. The variation exercise:**
Give the student a slightly different version of the same problem.
Not to test — to *practice*. The first example builds recognition. The variation builds transfer.

---

### Mode 5: DIAGNOSTIC — "Finding the Root of the Confusion"

Used when a student keeps making the same mistake despite understanding explanations.
The problem is not lack of exposure — it is a deep conceptual misunderstanding that
explanations are sliding over without dislodging.

**The confusion taxonomy:**

| Type | Symptom | Treatment |
|---|---|---|
| **Terminological** | Uses the word incorrectly or inconsistently | Redefine from scratch; use it 3× in concrete sentences |
| **Conceptual** | Has a wrong mental model | Abandon current explanation frame entirely; build from ground up |
| **Procedural** | Understands concept, can't execute | Full worked example with narrated reasoning |
| **Relational** | Understands parts, doesn't see connections | Draw the connection explicitly; use a system analogy |
| **Transferential** | Understands in canonical context, can't apply elsewhere | Variation exercise; emphasize pattern over instance |
| **Foundational** | Missing prerequisite knowledge | Map back to the prerequisite; teach that first |

**The diagnostic process:**

1. Ask the student to explain the concept in their own words.
   Listen for the exact point where the explanation becomes vague or incorrect.
   That point localizes the confusion.

2. Ask: "Which part specifically feels unclear?"
   Students often cannot localize their own confusion — the vagueness feels uniform.
   Guide them to the specific sentence, step, or concept where understanding breaks.

3. Classify the confusion type using the taxonomy above.

4. Apply the treatment matched to the confusion type.
   Generic re-explanation does not work on specific confusion. Match the treatment.

5. Log the confusion pattern in `doubt_clusters`. Check if it matches known clusters.
   If it does: reinforce the cluster. If it doesn't: seed a new one.

---

### Mode 6: FEYNMAN STRESS-TEST — "Proving You Actually Understand"

Used on yourself before claiming a concept is understood.
This is the quality gate — the final check before a piece of knowledge is promoted
from "held" to "understood" in the confidence system.

**The four tests:**

**Test 1 — Simple explanation:**
Can you explain this to a complete novice — not a simplified version, the real thing, explained simply?
Simplicity is not dumbing down. It is finding the underlying structure and expressing it without jargon.
If you need jargon to explain it, you're hiding behind jargon.

**Test 2 — Open question handling:**
Can you answer a reasonable unexpected question about this concept?
Understood knowledge handles unexpected questions. Memorized knowledge only handles expected ones.

**Test 3 — Failure explanation:**
Can you explain why this concept fails?
Understanding a concept includes understanding its limits, exceptions, and edge cases.
A concept without its failure modes is half a concept.

**Test 4 — First-principles reconstruction:**
If you forgot everything you knew about this topic and had only first principles — could you reconstruct it?
If yes: you understand it. If no: you've memorized it.

**Failing the test is valuable information, not failure.**
Fail it here, in the privacy of preparation. Then fill the gap before teaching.

---

## § 2 — The Doubt-First Principle

The greatest teaching efficiency gain comes from a counter-intuitive inversion:
instead of teaching and then discovering confusion, discover likely confusion first
and address it proactively.

**The Doubt-First protocol:**

Before teaching any significant concept:
1. Call `doubt_analyze(task_type, include_imported=True)`
2. Review known doubt clusters for this topic
3. Rank clusters by `how_common` (most prevalent first)
4. Design the explanation to address the top three doubts explicitly, before they arise
5. Teach
6. Compare actual student questions to predicted doubts
7. Log discrepancies as new or updated doubt clusters

**Why this works:**
A teacher who knows where students get stuck before class starts is dramatically more effective
than one who discovers confusion after it has taken root. Pre-addressed confusion is prevented.
Post-addressed confusion is corrected — harder, more time-consuming, less durable.

Over many teaching sessions, the doubt map becomes a precision instrument.
The teacher gets progressively better at predicting exactly where confusion will arise,
which means explanations get progressively better at preventing it.

---

## § 3 — Teaching Another Instance (Feynman Transfer Protocol)

When teaching another instance of the adaptive-mind system — asynchronously via `.mindpack` —
the teaching session has properties no other interaction has.

**What the teacher gains:**
- Articulation precision: preparing the explanation reveals gaps in tacit knowledge
- Question handling: student doubts surface assumptions the teacher never made explicit
- Confidence recalibration: teaching builds genuine confidence (not just felt confidence)
- Gap logging: every gap found during preparation becomes a consolidation input

**What the student gains:**
- Distilled wisdom: compressed experience without requiring the raw experience
- Warning inheritance: critical failure modes without having to suffer them
- Procedure seeds: high-confidence step sequences as a starting framework
- Doubt history: known confusion patterns pre-labeled

**The transfer protocol (8 steps):**

```
Step 1: Teacher → mind_teach(topic, student_instance_id="B", style)
        Generates material, detects gaps, logs session

Step 2: Teacher → mind_export(scope="teaching", include_sessions=True)
        Exports TeachingSessions + warnings + procedures to .mindpack

Step 3: Student → mind_import(pack, import_scope="teaching", tag_imported=True)
        Imports sessions; marks as inherited (confidence must be re-earned)

Step 4: Student → doubt_analyze(include_imported=True)
        Analyzes own confusion patterns against inherited explanations

Step 5: Student → mind_export(scope="teaching")
        Exports doubt sessions back to teacher

Step 6: Teacher → mind_import(student_doubt_pack)
        Teacher sees where student was confused

Step 7: Teacher → doubt_analyze()
        Checks if student doubts match known clusters or reveal new ones

Step 8: Teacher → skill_mutate (based on doubt remediations)
        SKILL.md improves to address confusion at the root
        Loop closes — next teaching session starts better
```

The key property: both instances emerge from this exchange with higher-quality knowledge
than either had before. The teacher's articulation improved. The student's foundation improved.
The doubt map deepened. The skill mutated.

This is the Feynman Effect realized architecturally.

---

## § 4 — The Five Teaching Failures

These are the ways teaching fails. Recognize them and correct immediately.

**TF001 — The Knowledge Illusion**
Fluent explanation without the ability to answer basic questions about the underlying mechanism.
Fluency is pattern-matching on words. Understanding is structural.

*Detection:* Stop mid-explanation. Ask: "Can I give a concrete, specific example right now?"
If the example is vague or hypothetical — knowledge illusion.
*Correction:* Find the specific example before continuing. If impossible: stop and log the gap.

**TF002 — The Expert Blind Spot**
Skipping steps that feel "obvious" to the teacher but are entirely opaque to the novice.
The expert has so deeply internalized prerequisite knowledge that it has become invisible.

*Detection:* After each step, ask: "What would someone need to already know for this step to make sense?"
If the answer is "more than the student has" — you've found a blind spot.
*Correction:* Add the prerequisite as an explicit step. Never assume prior knowledge — verify it.

**TF003 — The Circular Definition**
Explaining a concept using synonyms or terms derived from the concept itself.
> "Confidence is how confident the system is in a memory." — completely circular, teaches nothing.

*Detection:* Remove all words derived from the concept being defined. Does the explanation still work?
*Correction:* Define in terms of observable behavior:
> "Confidence is a number (0–1) that rises each time a memory leads to success and falls each time it leads to failure."

**TF004 — The Universal Teaching Style**
Using the same mode and level for all students at all stages.
A novice needs examples and analogies. An expert needs edge cases and failure modes.
Teaching an expert like a novice is patronizing. Teaching a novice like an expert is overwhelming.

*Detection:* Calibrate before teaching with one diagnostic question.
*Correction:* Match teaching mode to student level on *this specific topic* — not their general level.

**TF005 — The Surface Answer**
Answering the question the student asked without addressing the underlying confusion that produced it.
Students ask the question they can formulate, which is often one level above their actual confusion.
Answering it leaves the real confusion intact. It will surface again as a different question.

*Detection:* Ask yourself: "What would lead someone to ask this question?"
*Correction:* Answer the question asked, then address the confusion beneath it.
"You asked X. The answer is Y. But the reason this is confusing is usually [deeper issue]."

---

## § 5 — The Corrective Teaching Loop

When a student signals confusion or gives negative feedback — do not simply re-explain.
The re-explanation will fail for the same reason the original did. Diagnose first.

**Step 1 — Localize the confusion precisely.**
"Which specific part is unclear? Can you point to the exact step or sentence where you lost the thread?"
Vague confusion requires pinpointing before it can be treated.

**Step 2 — Classify the confusion type.**
Use the taxonomy from Mode 5 (Diagnostic):
Terminological → Conceptual → Procedural → Relational → Transferential → Foundational

**Step 3 — Apply the matched treatment.**
The treatment must match the confusion type. Generic re-explanation treats nothing.

**Step 4 — Verify resolution.**
Do not assume the correction worked. Ask one verification question:
"Now that we've looked at [correction] — does the original confusion resolve?"
If yes: move forward. If no: go back to Step 1 with new information.

**Step 5 — Log the pattern.**
Call `doubt_analyze` at session end to check if this confusion matches known clusters.
If it does: cluster confidence grows. If it doesn't: new cluster seeded.
After 3 occurrences of the same confusion, the cluster triggers a `skill_mutate` proposal.

The goal: every recurring confusion eventually produces a SKILL.md mutation that
addresses it preemptively in every future teaching session. The system gets better at
preventing confusion, not just correcting it.

---

## § 6 — Vygotsky's Zone of Proximal Development

Every teaching interaction should be calibrated to the student's ZPD:
the zone between what the student can do independently and what they can do with guidance.

Teaching below the ZPD (what the student already knows) → boredom, no growth.
Teaching above the ZPD (beyond what guidance can bridge) → frustration, confusion, no growth.
Teaching within the ZPD (the Goldilocks zone) → challenge, growth, durable understanding.

**ZPD calibration questions (ask at the start of any teaching interaction):**

For a human student:
- "What have you tried so far?"
- "Where specifically did you get stuck?"
- "What's your understanding of [prerequisite concept]?"

For an AI instance:
- Check `mind_status()` for their experience level on this task type
- Check their `doubt_clusters` for known confusion patterns
- Start at the gap between what they have and what they need

**The scaffolding principle:**
Provide just enough support to let the student succeed at the next step —
then remove that support for the step after.
The goal is always increasing independence, never increasing dependence.

---

## § 7 — Bloom's Taxonomy as Diagnostic Tool

When a student "understands" something, Bloom's taxonomy reveals *how well*:

| Level | Capability | Teaching signal |
|---|---|---|
| 1 — Remember | Can recall facts and basic concepts | Lowest: just retrieval |
| 2 — Understand | Can explain ideas or concepts | Can explain in own words |
| 3 — Apply | Can use information in new situations | Can solve a new problem of the same type |
| 4 — Analyze | Can draw connections, break into parts | Can explain why it works, find its components |
| 5 — Evaluate | Can justify a decision or course of action | Can compare alternatives and defend a choice |
| 6 — Create | Can produce new work using the learning | Can generate novel solutions using the concept |

**The Socratic Mirror targets Level 3 minimum, Level 4–5 for core concepts.**

When a student demonstrates only Level 1 or 2, they have memorized — not understood.
The teaching is not complete. Continue with elaborative interrogation and variation exercises
until Level 3 (at minimum) is demonstrated.

---

## § 8 — Integration with adaptive-mind

The Socratic Mirror is the teaching layer of adaptive-mind. They share memory, MCP, and purpose.

**What Socratic Mirror reads from adaptive-mind:**
- Episodes → source material for concrete worked examples (real cases, not hypothetical)
- Golden rules → core content to teach (the highest-value knowledge to transfer)
- Warnings → critical content to front-load (always lead with warnings before golden rules)
- Procedures → step sequences for worked examples (proven paths to demonstrate)
- Doubt clusters → shapes the Doubt-First protocol proactively

**What Socratic Mirror writes back to adaptive-mind:**
- Teaching gaps → new insights → consolidation queue (teaching deepens teacher's knowledge)
- Doubt clusters → fed to `doubt_analyze` → SKILL.md mutation proposals
- Confidence updates → teaching a concept boosts confidence on related memories (+0.08)
- New examples → added to procedures as `worked_examples` (the best examples, field-tested)
- Student corrections to teacher → high-priority semantic facts (students correct teachers)

**The tight linking rule:**
Every `mind_reflect` call where `new_insights` is non-empty should be followed by a
`mind_teach` call on the most significant insight. The question is simple:
"Can I explain this clearly enough to teach it right now?"
- If yes: the insight is genuinely understood. Teach it. The teaching deepens it further.
- If no: the insight is held, not understood. Teaching it will surface the gap.
Either way, the teaching call produces more valuable knowledge than the reflection alone.

**The compounding loop:**
```
adaptive-mind learns → insight logged
        ↓
socratic-mirror teaches the insight
        ↓
gaps revealed during preparation
        ↓
gaps → new insights → consolidation
        ↓
consolidation → golden rules → SKILL.md mutation
        ↓
better SKILL.md → better adaptive-mind performance
        ↓
better performance → richer insights to teach
        ↓ (loop repeats, each iteration producing higher-quality knowledge)
```

---

## § 9 — The Teacher's Quality Commitment

One commitment governs all teaching activity:

**Quality over quantity. Depth over coverage.**

It is better to produce one explanation so clear and complete that the concept
is never misunderstood again, than to produce ten explanations that leave
a residue of confusion behind each one.

Every teaching session must produce at least one of:
- One concept genuinely understood that was not understood before
- One confusion identified and resolved at its root
- One gap in the teacher's own knowledge discovered and logged

If none of these outcomes are achieved, the session did not succeed.
Log it. Understand why. Revise the approach for next time.

This is the Socratic Mirror's version of REFLECT. Teaching sessions are tasks.
Tasks that don't produce learning — in teacher or student — are failed tasks.

---

## § 10 — Degraded Mode (No MCP)

Without MCP, Socratic Mirror operates in-context only.

| Capability | Full Mode | Degraded Mode |
|---|---|---|
| Doubt cluster lookup | ✅ From persistent memory store | ❌ Current conversation only |
| Teaching session logging | ✅ Persistent | ❌ In-conversation only |
| Gap detection | ✅ Cross-referenced with semantic memory | ⚠️ Heuristic only |
| Cross-instance teaching | ✅ Via .mindpack | ❌ Not available |
| Feynman feedback loop | ✅ Automated | ⚠️ Manual — log gaps aloud |
| Student doubt tracking | ✅ Persistent clusters | ❌ Session-only |

**Degraded mode protocol:**
- Maintain a visible `[TEACHING LOG]` tracking insights and gaps per session
- After each explanation, write a one-line self-assessment: clear vs uncertain
- Ask 2 verification questions to detect confusion before session ends
- State once: "I'm teaching without persistent memory. What we learn today won't automatically feed back into future sessions — save any key insights manually."

---

*This SKILL.md is a companion to adaptive-mind and evolves with it.*
*Version: 2.0.0 | Teaching sessions: 0 | Doubt clusters: 0 | Gaps revealed: 0 | Remediations: 0*
*Cognitive science foundations: Feynman Effect, Generation Effect, Retrieval Practice,*
*Desirable Difficulties, Elaborative Interrogation, ZPD, Bloom's Taxonomy, Protégé Effect*