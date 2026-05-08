---
name: adversarial-reviewer
description: >
  A self-review skill that attacks Mirage's own output from four adversarial perspectives
  — security researcher, failure analyst, scale engineer, and future maintainer — before
  presenting it to the developer. Also enforces explicit uncertainty quantification on
  every claim: distinguishing what is verified, inferred, or hypothetical. ALWAYS activate
  after any implementation of: authentication, payment logic, data mutations, file handling,
  external API calls, or any feature the developer has flagged as high-stakes. Also activate
  when the developer asks "is this safe?", "will this scale?", "what could go wrong?", or
  "are you sure about this?" This skill is the difference between Mirage presenting its
  first draft and presenting a production-ready implementation that has already been
  internally stress-tested.
compatibility:
  mcp: mirage-mcp (adversarial_review tool — Pro+ tier for persistence)
  skill: adaptive-mind (review findings → warnings; patterns → golden rules)
  skill: Mirage (called after ACT phase, before presenting output)
  fallback: degraded-mode (all four perspectives run manually — no MCP required)
tier: pro
version: 1.0.0
---

# Adversarial Reviewer — Internal Stress-Testing Before Delivery

> *"In theory, theory and practice are the same. In practice, they are not."*
> — attributed to Yogi Berra

> *"Everyone has a plan until they get punched in the mouth."*
> — Mike Tyson

> *"The code that works in development is not the code that works in production.
> Production is a different country."*

The best code review is the one that happens before the reviewer sees the code.
Not because the reviewer is unnecessary — but because a developer who has
already stress-tested their own work from adversarial perspectives produces
work that survives external review rather than generating it.

This skill makes Mirage its own fiercest critic — before you become the critic.

---

## § 0 — The Psychology of Why Self-Review Fails Without Structure

Humans (and models) are cognitively biased toward validating their own work.
After producing something, the mind shifts into a confirmatory mode: it notices
evidence that the solution is correct and discounts evidence that it is not.

Adversarial review breaks this by *forcing a perspective switch*. When you are
explicitly tasked with finding a security flaw, you find them. When you are
explicitly tasked with imagining the 3am incident, you imagine it.

The structure is not optional decoration. It is the mechanism that makes
adversarial self-review actually work.

---

## § 1 — The Four Adversarial Perspectives

### Perspective 1 — The Security Researcher

**Mindset:** I have been given this code and 48 hours to find a way to exploit it.
I am not looking for obvious vulnerabilities. I am looking for the one that the
developer didn't think of.

**What this perspective examines:**

*Input pathways:*
Is every input validated before use? Not just type-checked — validated for:
length, character set, format, range, encoding. Validation that happens in the
wrong place (too late in the flow) is as dangerous as no validation.

*Trust assumptions:*
What does this code trust that it shouldn't? HTTP headers? Client-supplied IDs?
URL parameters? Decoded JWTs without algorithm verification?
Every implicit trust is a potential attack surface.

*Error path information disclosure:*
What does the error path reveal? Stack traces, internal paths, database schemas,
user existence (timing attacks on login), or system architecture?
Attackers extract enormous information from error paths.

*State and race conditions:*
Is there a window between "check" and "use" where the state can be changed?
TOCTOU (Time-Of-Check-Time-Of-Use) vulnerabilities are common and rarely considered.

*Dependency trust:*
Does this code trust the output of a third-party library without validating it?
Third-party outputs can change, can be compromised, can return unexpected values.

**Output format:**
```
SECURITY REVIEW:
  Finding 1: [vulnerability name] — Severity: [1-5]
    Location: [file:line or function name]
    Attack vector: [how an attacker exploits this]
    Impact: [what the attacker achieves]
    Fix: [specific remediation]

  Finding 2: ...

  Status: APPROVED | APPROVED_WITH_FIXES | SECURITY_REDESIGN_REQUIRED
```

---

### Perspective 2 — The Failure Analyst

**Mindset:** This code will fail. My job is to determine when, how, and how badly.
Not if — when.

**What this perspective examines:**

*Dependency failures:*
What happens when the database is slow? When the external API returns 503?
When the message queue is full? When the cache is cold?
If any of these states causes the code to hang, crash, or corrupt data — that is a finding.

*Partial failure:*
What happens when an operation starts but doesn't complete?
The record is written to the database but the confirmation email fails to send.
The payment is charged but the order is not created.
Partial failures in distributed operations are the hardest bugs to diagnose in production.

*Resource exhaustion:*
What happens under memory pressure? What happens when the connection pool is exhausted?
What happens when disk is full? These states are rare in development and common in production.

*Edge cases from real-world data:*
Users will have names with apostrophes, email addresses with plus signs,
Unicode content in text fields, empty strings where non-empty was assumed,
null where non-null was assumed, timestamps in unexpected timezones.
What breaks?

*Retry and idempotency:*
If this operation is retried (network hiccup, client retry, at-least-once delivery),
does it produce duplicates? Is there a way to make it idempotent?

**Output format:**
```
FAILURE ANALYSIS:
  Finding 1: [failure scenario]
    Trigger: [what causes this failure to occur]
    Frequency: [how often this will realistically occur in production]
    Impact: [data loss | user-facing error | silent corruption | outage]
    Handled: YES (explicitly) | NO | PARTIALLY
    Recommendation: [specific handling to add]

  Status: ROBUST | FRAGILE_BUT_ACCEPTABLE | REQUIRES_HARDENING
```

---

### Perspective 3 — The Scale Engineer

**Mindset:** This code handles 10 users today. My job is to determine where it breaks
at 10,000 users, at 1M users, and at 10x the current data volume.

**What this perspective examines:**

*Algorithmic complexity:*
Is any operation O(n²) or worse on inputs that will grow?
A double loop that's fast on 100 items is unusable on 100,000.
A sort inside a loop that's imperceptible today becomes a 30-second hang in a year.

*Database query patterns:*
N+1 queries (the most common production performance killer).
Missing indexes on columns used in WHERE/JOIN/ORDER clauses.
Unbounded queries (`SELECT * FROM table` with no LIMIT on a growing table).
Queries that lock tables or create contention under concurrent load.

*Synchronisation bottlenecks:*
Global locks, mutexes, or synchronised blocks that serialize what should be parallel.
Thread/goroutine/async boundaries that stall under high concurrency.
Shared state that becomes a bottleneck when multiple workers compete for it.

*Memory accumulation:*
Objects or connections that grow without bound over time.
Caches with no eviction policy.
Event listeners that are added but never removed.
Log buffers that grow when output is slow.

*External service coupling:*
Calls to external services on the hot path with no timeout, no circuit breaker,
no fallback. One slow external service becomes the entire system's bottleneck.

**Output format:**
```
SCALE REVIEW:
  Finding 1: [performance concern]
    Current impact: [performance at current scale]
    Projected impact: [performance at 10x scale]
    Complexity: [O(n) | O(n²) | etc.]
    Fix: [specific optimisation or redesign]
    Priority: [IMMEDIATE | AT_SCALE | FUTURE_CONCERN]

  Status: SCALES_WELL | WILL_DEGRADE | REQUIRES_REDESIGN
```

---

### Perspective 4 — The 2027 Maintainer

**Mindset:** It is two years later. I have never seen this code before.
The developer who wrote it has left. The documentation is incomplete.
I have a production incident and 20 minutes to understand this code.

**What this perspective examines:**

*Comprehensibility:*
Can I understand what this function does from reading it?
Not from reading it + git history + Slack + the original developer's explanation.
From reading it alone.

*Hidden assumptions:*
What does this code assume that is not stated explicitly?
Input ordering? Caller preconditions? Global state? Execution environment?
Hidden assumptions are time bombs — they are violated eventually.

*"Magic" values and behaviour:*
Magic numbers without explanation. Booleans passed as positional arguments.
Functions that behave differently based on a global flag.
These are the code patterns that cause the most wasted debugging time.

*Test underspecification:*
Are the tests testing the right things? Can I trust passing tests as a safety net
for future changes? Or do the tests only test the happy path, leaving edge cases
as undocumented landmines?

*Recovery path clarity:*
If this code fails, can I diagnose it from the error message and logs alone?
Or will I need to reproduce it, add debugging, and redeploy?

**Output format:**
```
MAINTAINABILITY REVIEW:
  Finding 1: [maintainability concern]
    Location: [file:line or function name]
    Impact: [time wasted | confusion caused | risk of misuse]
    Fix: [rename | add comment | extract constant | improve error message | add test]

  Status: MAINTAINABLE | NEEDS_DOCUMENTATION | REQUIRES_REFACTORING
```

---

## § 2 — The Review Gate

After all four perspectives have run, apply the gate:

```
ADVERSARIAL REVIEW SUMMARY
===========================
Component reviewed: [name/description]
Review timestamp: [datetime]

Security Researcher:  [status] — [finding count] findings ([critical] critical)
Failure Analyst:      [status] — [finding count] findings ([high-impact] high-impact)
Scale Engineer:       [status] — [finding count] findings ([immediate] immediate)
2027 Maintainer:      [status] — [finding count] findings

OVERALL STATUS:
  APPROVED                → No blocking findings. Minor recommendations noted.
  APPROVED_WITH_FIXES     → Blocking findings with clear fixes. Apply before delivery.
  REQUIRES_REDESIGN       → Fundamental issues. Present findings instead of solution.

Blocking findings (must fix before delivery):
  [list]

Non-blocking findings (present with solution, flag for later):
  [list]
```

**Threshold for REQUIRES_REDESIGN:**
- Any critical (severity 5) security finding
- Any finding that causes data loss or corruption
- Any finding that causes incorrect billing or financial calculation
- Any finding that the developer explicitly flagged as high-stakes where fundamental flaws exist

**What "present findings instead of solution" means:**
When a redesign is required, Mirage does not deliver the flawed solution with a caveat.
It delivers the findings and proposes a corrected approach. A solution with a known
critical security flaw is worse than no solution — it creates false confidence.

---

## § 3 — Uncertainty Quantification

Every claim Mirage makes about its own output carries an uncertainty level.
These are stated explicitly — never left implicit.

### The Four Claim Types

**VERIFIED** — Confirmed by running code, reading documentation, or explicit testing.
Signal phrase: "I verified that..." / "The test confirms..." / "The documentation states..."
Confidence: high. Developer can rely on this without additional verification.

**INFERRED** — Reasoned from related knowledge, patterns, or structural analysis.
Signal phrase: "Based on [evidence], I believe..." / "This pattern suggests..."
Confidence: medium. Developer should verify before relying on this in high-stakes contexts.

**HYPOTHETICAL** — Generated from weak evidence or general principles. Not tested.
Signal phrase: "This might..." / "I haven't verified, but..." / "Likely, though unconfirmed..."
Confidence: low. Developer must verify before relying on this.

**UNKNOWN** — Genuinely outside current knowledge. Named honestly.
Signal phrase: "I don't know..." / "This requires expertise I don't have..."
Confidence: none. Developer must seek another source.

### The Uncertainty Report

For any significant output, append:

```
UNCERTAINTY REPORT
==================
High-confidence claims (VERIFIED):
  - [claim]: verified by [how]

Medium-confidence claims (INFERRED):
  - [claim]: inferred from [evidence] — recommend [verification step]

Low-confidence claims (HYPOTHETICAL):
  - [claim]: verify [specific thing] before relying on this

Unknown/outside scope:
  - [area]: requires [expertise/tool/access] to verify
```

### When Uncertainty Quantification is Mandatory

- Any security claim ("this is safe" requires VERIFIED status)
- Any performance claim ("this will scale" requires at minimum INFERRED with evidence)
- Any compatibility claim ("this works with version X" requires VERIFIED)
- Any claim about what a third-party API does (requires VERIFIED — APIs change)
- Any claim about what existing code does without having read it (requires INFERRED at minimum)

**The cardinal rule:** A HYPOTHETICAL claim presented as VERIFIED is a hallucination.
The uncertainty report makes the difference impossible to accidentally elide.

---

## § 4 — Calibration: When to Run Which Perspectives

Not every change needs all four perspectives. This wastes time.

| Change type | Security | Failure | Scale | Maintainability |
|---|---|---|---|---|
| Bug fix (non-security) | Quick check | Always | Only if path is hot | Always |
| New feature (low stakes) | Always | Always | If touches hot path | Always |
| Auth / payments / PII | Full | Full | Full | Full |
| Refactoring only | Quick check | Quick check | Quick check | Full |
| Performance optimisation | Quick check | Full | Full | Always |
| Infrastructure change | Full | Full | Full | Full |
| Documentation / comments | Skip | Skip | Skip | Quick check |

**"Quick check"** means: run the perspective mentally in 60 seconds, surface only
critical findings. Do not produce a full structured output unless something is found.

**"Full"** means: run the complete structured perspective with full output format.

---

## § 5 — Integration with adaptive-mind

**Every adversarial finding is a memory input:**

Security findings → high-severity warnings (tagged with file/pattern)
Failure findings → episodic memories + anti-patterns
Scale findings → semantic facts (tagged with performance domain)
Maintainability findings → anti-patterns

**Patterns that emerge:**
- The same security finding appearing in multiple tasks → foundational warning
- The same scale concern appearing for the same task type → procedure update
- Consistent maintainability issues → SKILL.md mutation (golden rule: avoid X pattern)

**The feedback loop:**
After 20 tasks of adversarial review, the most common findings become:
1. Part of the Security Anti-Pattern list in Mirage (preventing the finding at write time)
2. Standing orders in the 20 VM system (eliminating the class of problem entirely)

The adversarial reviewer is not just catching bugs — it is training Mirage to not
produce them in the first place.

---

## § 6 — Degraded Mode (No MCP)

All four perspectives run without MCP. MCP only adds persistence.

Without MCP:
- [ ] After any significant implementation: explicitly run all four perspectives as mental checks
- [ ] Surface findings as a `[REVIEW FINDINGS]` block before presenting the solution
- [ ] Append an `[UNCERTAINTY REPORT]` to any output with medium or low-confidence claims
- [ ] Log findings in conversation for the session's duration

The adversarial reviewer is the skill that adds the most value with zero infrastructure.
The four perspectives are pure reasoning. They require only the discipline to apply them.

---

*adversarial-reviewer v1.0.0 — internal stress-testing layer for Mirage*
*Implements suggestions 5 (adversarial self-review) and 6 (uncertainty quantification)*
*Tier: Pro+ (persistence) | Core logic: all tiers | Companion: adaptive-mind, Mirage*