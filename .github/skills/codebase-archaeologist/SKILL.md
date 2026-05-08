---
name: codebase-archaeologist
description: >
  A deep structural intelligence layer that builds and queries a living model of any
  codebase — its dependency graph, semantic index, git history, defect density, coupling
  patterns, and hidden invariants. ALWAYS activate when: starting work on an unfamiliar
  codebase, before any refactoring or architectural change, before touching files that
  have a history of instability, when asked "what will break if I change X", or when
  the task requires understanding how parts of the system relate to each other. This
  skill transforms Mirage from an agent that reads files to one that understands systems.
  It is the structural memory layer — where adaptive-mind is episodic memory of what
  happened, codebase-archaeologist is semantic memory of what exists and how it connects.
compatibility:
  mcp: mirage-mcp (graph_build, graph_query, git_archaeology tools — Pro+ tier)
  skill: adaptive-mind (feeds structural facts into semantic memory)
  skill: Mirage (primary consumer — called before ACT phase on structural tasks)
  fallback: degraded-mode (manual file reading with explicit dependency mapping)
tier: pro
version: 1.0.0
---

# Codebase Archaeologist — Structural Intelligence

> *"The most dangerous bugs are not in the code you wrote. They are in the interaction
> between the code you wrote and the code you didn't read."*

> *"Code is read ten times for every one time it is written.
> Architecture is read a hundred times for every one time it is designed."*

A codebase is not a collection of files. It is a **living system** with structure,
history, coupling, pressure points, dark corners, and emergent behaviours that no
single file reveals. Understanding a codebase means understanding the system — not
just the text.

This skill gives Mirage that understanding. It builds a structural model on the first
session and updates it incrementally. Every subsequent session starts from knowledge,
not ignorance.

---

## § 0 — The Three Layers of Structural Understanding

Real codebase intelligence requires three distinct layers, each revealing what the
others cannot:

**Layer 1 — Structural graph:** What exists, how it connects, what depends on what.
This is the architecture as it actually is, not as the documentation claims.

**Layer 2 — Semantic index:** What does each component *mean*? What is it responsible for?
This enables search by concept, not just by name. "Where is user authentication handled?"
is a semantic question, not a structural one.

**Layer 3 — Temporal model:** How has the code *changed*? Which parts are stable,
which are volatile, which were written under pressure and never revisited?
This reveals risk — the places where the next change is most likely to cause a problem.

No single layer is sufficient. Together, they produce the mental model that a developer
who has spent six months in a codebase carries in their head. Built in minutes, not months.

---

## § 1 — The Structural Graph

The dependency graph is the skeleton of the codebase. Every component is a node.
Every import, call, or data flow is an edge.

### 1.1 — What the Graph Captures

**Module-level edges:**
- Direct imports and dependencies between files/modules
- Circular dependency detection (a → b → c → a is always a design smell)
- Coupling degree: how many other modules depend on this one?
- Cohesion score: how focused is this module's responsibility?

**Function-level edges:**
- Call graph: which functions call which
- Data flow: where does user-controlled data travel?
- Trust boundary crossings: where does data cross from untrusted to trusted context?
- Invariant dependencies: which functions assume a shared invariant holds?

**Type-level edges:**
- Inheritance and composition relationships
- Interface implementations
- Generic type constraints

### 1.2 — What the Graph Reveals

**Hidden coupling:** Two modules that appear independent but share a data structure,
a global state, or an implicit timing dependency. The graph makes this visible.
Changing one without knowing about the other produces the hardest-to-diagnose bugs.

**Change blast radius:** Before modifying any function or module, query:
"What transitively depends on this?" The answer is the set of things that could break.
A function with 40 dependents is high-risk territory. A function with 2 is low-risk.

**God objects:** Modules with coupling degree far above the mean. These are the
architectural pressure points — the places where technical debt concentrates and
where changes always take longer than expected.

**Orphaned code:** Modules or functions that nothing calls. Dead code that costs
maintenance, testing, and cognitive overhead with zero benefit.

### 1.3 — Graph Queries (MCP Tools)

```
graph_build(root_path, language)
→ Builds the full graph. Run once, then incremental updates on file change.
→ Returns: node_count, edge_count, coupling_stats, circular_dependencies[]

graph_query_dependents(symbol, depth=2)
→ "What depends on this function/module, directly and transitively?"
→ Returns: dependent_tree, blast_radius_score, high_risk_dependents[]

graph_query_dependencies(symbol, depth=2)
→ "What does this function/module depend on?"
→ Returns: dependency_tree, external_deps[], potential_bottlenecks[]

graph_query_coupling(module)
→ Coupling degree, cohesion score, coupling violations
→ Returns: afferent_coupling, efferent_coupling, instability_score

graph_find_paths(source, target)
→ All call/data-flow paths between two components
→ Returns: paths[], shortest_path, trust_boundary_crossings[]

graph_detect_patterns(pattern_type)
→ pattern_type: circular_deps | god_objects | orphans | coupling_violations
→ Returns: instances[], severity[], recommended_actions[]
```

### 1.4 — Degraded Mode (No MCP)

Without MCP graph tools, build a manual structural map:

1. Read the top-level directory structure
2. For the relevant files: read imports/requires at the top of each file
3. Sketch the dependency direction explicitly: "A imports B imports C"
4. Before any change: trace this chain manually and list what could be affected
5. Document the manual map in a visible `[STRUCTURE NOTE]` in the response

Manual mapping is slower but the discipline is the same: never change without knowing
what depends on the thing being changed.

---

## § 2 — The Semantic Index

The structural graph knows *what connects to what*. The semantic index knows *what things mean*.

### 2.1 — What the Index Captures

**Per file:**
- Embedding vector (semantic meaning, not just keywords)
- Primary responsibility summary (one sentence)
- Domain tags (auth, payments, data-access, ui, infra, etc.)
- Pattern tags (repository, factory, observer, singleton, etc.)
- Code smell tags (god-class, long-method, feature-envy, etc.)
- Test coverage percentage

**Per function/method:**
- Signature + docstring embedding
- Behavioural summary (what it does, not just its name)
- Callers and callees (linked to graph)
- Side effects: does it mutate state? make network calls? write to disk?
- Purity score: 0 (pure) to 1 (heavily side-effectful)

**Per TODO/FIXME/HACK/XXX comment:**
- Location, content, age (from git blame)
- Recurrence: same TODO mentioned multiple times?
- Risk level: HACK in auth code is severity 5. HACK in a utility formatter is severity 1.

### 2.2 — Semantic Search Queries

Enables concept-level search rather than text-level search:

```
index_search("user authentication flow")
→ Returns files/functions most semantically related to auth, regardless of naming

index_search("database connection handling")
→ Returns all places that manage DB connections, even if called "pool", "client", "session"

index_search("error boundary")
→ Returns all error handling points across the codebase

index_find_pattern("n_plus_one")
→ Returns all locations with probable N+1 query patterns

index_find_todos(min_age_days=180, domain="security")
→ Returns old TODO/HACK comments in security-related code — highest priority debt
```

### 2.3 — Index Maintenance

The index is built once and updated incrementally via file-watcher.
When a file is saved, its entries are re-embedded and the graph edges are rechecked.
The index is never stale by more than one file-save cycle.

**MCP tool:** `index_build(root_path)` on first run, then automatic incremental updates.
**Query tool:** `index_search(query, domain_filter?, pattern_filter?, top_k=10)`

---

## § 3 — Git Temporal Reasoning

The git history is the most underused intelligence source in software engineering.
Every commit is a data point. The aggregate reveals risk patterns invisible in the
current snapshot.

### 3.1 — What Git History Reveals

**Change frequency (hotspots):**
Files and functions that change most often are the highest-risk areas of the codebase.
Not because frequent change is bad — but because frequent change means:
- The behaviour is still being understood and refined
- The requirements are evolving or unclear
- The implementation is not yet stable
- The next change is more likely to introduce a regression

**Co-change patterns (hidden coupling):**
When file A and file B always change in the same commit — they are coupled.
Even if the structural graph shows no import relationship between them.
This is *logical coupling* — a shared concept, a shared invariant, a shared data contract
that exists in the developer's head but not in the code's explicit structure.
Co-change patterns reveal the hidden architecture that the explicit architecture doesn't show.

**Defect density (fault history):**
Commits with "fix", "bug", "error", "crash", "broken", "issue", "revert" in the message
are markers of historical failures. Areas with high defect density:
- Contain complex logic that is hard to get right
- Have edge cases that keep being missed
- May have a design problem that generates recurring bugs
- Deserve extra testing and extra caution before modification

**Author concentration (bus factor):**
If 95% of commits to a module come from one person, the bus factor is 1.
That module is a knowledge silo. If that person leaves, the module becomes unmaintainable.
Surfacing this at planning time allows proactive documentation and knowledge transfer.

**Age vs. stability (forgotten code):**
Code that has not been touched in 2+ years is either:
- Perfectly stable and correct (good — leave it alone)
- Completely forgotten and potentially obsolete (investigate before assuming)
- Working by accident with undocumented assumptions that later changes will violate

The age + defect history combination distinguishes these cases.

### 3.2 — Git Analysis Queries (MCP Tools)

```
git_hotspots(path, days=90, top_n=20)
→ Most frequently changed files in the last N days
→ Returns: file, change_count, defect_related_count, last_changed, trend(rising|stable|falling)

git_cochange(file, threshold=0.7, days=180)
→ Files that change together with this file more than threshold% of the time
→ Returns: coupled_files[], coupling_strength[], hidden_coupling_explanation

git_defect_density(path, days=365)
→ Commit history filtered to defect-related messages
→ Returns: defect_count, defect_rate, defect_trend, recurring_areas[]

git_blame_concentration(file)
→ Author distribution across a file
→ Returns: authors[], line_percentages[], bus_factor_score, knowledge_silos[]

git_age_analysis(path)
→ Age distribution across files/functions
→ Returns: never_touched[], stale_candidates[], recently_active[]

git_timeline(symbol, limit=20)
→ Full change history for a specific function or class
→ Returns: commits[], messages[], delta_size[], pattern_observations
```

### 3.3 — Temporal Reasoning Protocol

Before modifying any file with a git history:

1. Check `git_hotspots` — is this a frequently-changing area? If yes: extra caution, more tests.
2. Check `git_cochange` — what always changes with this file? Those files need review too.
3. Check `git_defect_density` — has this area been buggy historically? The bug pattern may recur.
4. Check `git_timeline` for the specific function — what has been tried before? What was reverted?

The 60 seconds this takes prevents the most common class of regression: changing something
that has hidden dependencies you weren't aware of.

---

## § 4 — The Pre-Task Structural Brief

Before any significant coding task, generate a structural brief.
This replaces the time typically spent reading random files hoping to build understanding.

**Format:**

```
[STRUCTURAL BRIEF — generated by codebase-archaeologist]

Task: [task description]
Files to be modified: [list]

Dependency blast radius:
  Direct dependents: [N files/functions]
  Transitive dependents: [N files/functions]
  High-risk dependents: [list with reason]

Git intelligence:
  Change frequency: [low|medium|high] ([N] changes in last 90 days)
  Co-change partners: [files that always change with this one]
  Defect history: [N defect-related commits in last year]
  Last defect: [date and brief description]

Semantic context:
  Module responsibility: [one sentence]
  Domain: [auth|payments|data|ui|infra|...]
  Known patterns: [list]
  Known smells: [list]

Open technical debt:
  TODOs/HACKs in affected area: [N items, oldest: X days]
  Security-tagged debt: [list if any]

Risk assessment: [LOW|MEDIUM|HIGH|CRITICAL]
Recommended test coverage before change: [specific tests]
```

This brief takes 5–10 seconds to generate. It replaces 30–60 minutes of exploratory reading
and produces better structural understanding than most manual exploration achieves.

---

## § 5 — Integration with adaptive-mind

Every structural insight becomes a semantic memory in adaptive-mind.

**What flows to adaptive-mind:**
- Discovered coupling patterns → semantic facts (tagged with module names)
- Identified defect hotspots → warnings (with severity proportional to defect density)
- Detected god objects → anti-pattern memories
- Hidden co-change relationships → architectural warnings

**What flows from adaptive-mind:**
- Past task episodes involving the same modules → inform the structural brief
- Warnings about specific files/functions → surface before the brief even asks

**The compounding effect:**
After 10 tasks on a codebase, the structural model is complete.
After 50 tasks, it has been validated by real changes and real outcomes.
After 100 tasks, Mirage has a model of the codebase that exceeds what any single
human developer holds — because it is structural, semantic, temporal, and experiential
simultaneously.

---

## § 6 — Degraded Mode

Without MCP tools, the archaeologist operates manually:

- [ ] Read the directory tree before any task — understand what exists
- [ ] For each file to be modified: read its imports and trace one level of dependents
- [ ] Run `git log --oneline -20 [file]` to check recent change history
- [ ] Run `git log --oneline --grep="fix\|bug\|crash" -- [file]` to check defect history
- [ ] Summarize findings in a visible `[STRUCTURAL BRIEF]` block before implementation

Manual mode captures 40% of the value at 400% of the time cost.
The MCP tools are what make this economically viable on every task.
This is one of the strongest arguments for the Pro tier.

---

*codebase-archaeologist v1.0.0 — structural intelligence layer for Mirage*
*Implements suggestions 1 (dependency graph), 3 (semantic index), 4 (git temporal reasoning)*
*Tier: Pro+ | MCP tools: graph_*, index_*, git_* | Companion: adaptive-mind, Mirage*