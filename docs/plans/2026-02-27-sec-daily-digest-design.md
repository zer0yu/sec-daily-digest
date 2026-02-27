# sec-daily-digest Design

**Date:** 2026-02-27
**Scope:** Define the skill, architecture, data flow, and quality gates for a security-focused daily digest based on CyberSecurityRSS.
**Repository Root:** `/Users/z3r0yu/z3dev/Skills/sec-daily-digest`

## 1. Goal and Audience

`sec-daily-digest` generates a daily curated report for cybersecurity researchers, with balanced focus on:

- AI development updates
- Daily security dynamics

Core output characteristics:

- Chinese title + Chinese summary
- Keep original English title/link for reference
- Dedicated vulnerability section with merged CVE/major incidents and source links

## 2. Confirmed Constraints

1. Runtime and language
- Implementation must use TypeScript.
- Runtime must use Bun.

2. OPML source policy
- Check remote `tiny.opml` update before each run:
  - https://github.com/zer0yu/CyberSecurityRSS/blob/master/tiny.opml
- Default source is `tiny.opml`.
- Must support configurable source `CyberSecurityRSS.opml`.
- On update check failure, continue with cached OPML (default strategy).

3. Provider policy
- Use `--provider openai|gemini|claude|ollama`.
- Explicit CLI provider selection has priority.
- Default provider is `openai`.
- Support OpenAI-style env format by default, while also supporting Gemini/Claude/Ollama formats.

4. Selection policy
- Ranking strategy is balanced: Security 50% + AI 50%.

5. Vulnerability merge policy
- Merge by CVE ID first.
- For major incidents without CVE IDs, merge by semantic clustering of title + summary.
- If many sources report the same major vulnerability, merge into one item and list all references.

6. Command namespace
- Skill trigger command is `/sec-digest`.

7. Config and state storage
- Use YAML for configuration.
- Store config/state/cache under `~/.sec-daily-digest/`.

## 3. High-Level Architecture (Modular Pipeline)

### 3.1 Skill and entry layer

- `SKILL.md`
  - Defines `/sec-digest` interaction flow and parameter collection.
  - Defines execution and result display behavior.

- `scripts/sec-digest.ts`
  - CLI entry.
  - Parses arguments, loads config, invokes pipeline.

### 3.2 Pipeline orchestrator

- `src/pipeline/run.ts`
  - Stage orchestration:
    1) OPML sync check
    2) RSS fetch + parse
    3) normalize + dedupe + time filter
    4) AI scoring
    5) vulnerability merge
    6) report rendering
    7) state persist

### 3.3 OPML management

- `src/opml/sync.ts`
  - Compares remote metadata/content hash.
  - Updates local cache when remote changed.
  - Fallback to local cached OPML when check fails.

- Local cache:
  - `~/.sec-daily-digest/opml/tiny.opml`
  - `~/.sec-daily-digest/opml/CyberSecurityRSS.opml`

### 3.4 Feed ingestion

- `src/rss/fetch.ts`
  - Concurrent fetch, timeout, retry with jitter.
  - Anti-basic-scraping headers:
    - User-Agent rotation
    - Accept / Accept-Language

- `src/rss/parse.ts`
  - Unified RSS/Atom parsing.
  - No hard storage-size limit while reading feed content.

### 3.5 AI abstraction

- `src/ai/providers/openai.ts`
- `src/ai/providers/gemini.ts`
- `src/ai/providers/claude.ts`
- `src/ai/providers/ollama.ts`
- `src/ai/providers/types.ts`
  - Unified provider interface and response contract.

- `src/ai/scoring.ts`
  - Multi-dimensional scoring with balanced security/AI weighting.

### 3.6 Vulnerability event merge

- `src/merge/vuln.ts`
  - CVE extraction + exact merge.
  - Semantic clustering fallback for major incidents without CVE.
  - Aggregates references from all linked sources.

### 3.7 Report generation

- `src/report/markdown.ts`
  - Generates bilingual-oriented markdown digest for security researchers.
  - Includes:
    - AI developments
    - Security dynamics
    - Vulnerability bulletin (merged events + references)

### 3.8 Config/state/logging

- `src/config/load.ts`
  - Reads/writes YAML config.
  - Applies CLI override priority.

- `src/state/store.ts`
  - Persist run metadata and OPML sync status.

- `src/log/logger.ts`
  - Writes run logs.

## 4. Data Flow

1) Startup
- Run with Bun: `bun scripts/sec-digest.ts ...`
- Load `~/.sec-daily-digest/config.yaml`.
- Merge CLI overrides.

2) OPML pre-check (mandatory each run)
- Select OPML profile:
  - default `tiny.opml`
  - optional `CyberSecurityRSS.opml`
- Check remote update state and sync local cache when needed.
- If remote check fails, continue using cached OPML.
- If first run has no cache and remote unavailable, fail with actionable message.

3) Feed ingestion
- Parse OPML feeds.
- Fetch and parse feeds concurrently with retry/backoff.
- Collect article candidates.

4) Normalization
- Canonicalize URLs.
- Remove tracking query params (e.g. `utm_*`).
- De-duplicate and apply time window.

5) AI scoring
- Use selected provider from `--provider` (default openai).
- Score by relevance/quality/timeliness plus topic fit.
- Apply balanced security/AI weighting.

6) Vulnerability merge
- Merge exact same CVE IDs.
- Cluster non-CVE major incidents by semantic similarity.
- Build merged event references.

7) Report rendering
- Output markdown digest with:
  - Chinese title + Chinese summary
  - original English title/link retained
  - dedicated merged vulnerability section

8) Persist state
- Save run metadata, OPML version markers, and logs in `~/.sec-daily-digest/`.

## 5. Error Handling and Degradation

1. OPML stage
- Remote check failure: warning + cached OPML fallback.
- Corrupted remote OPML: reject update, keep old cache.
- First run + no cache + remote unavailable: hard fail.

2. RSS stage
- Per-feed failure does not stop pipeline.
- Track fail reasons (timeout/HTTP/parse).
- Retry 403/429 with mild backoff.
- If coverage below threshold, mark report as low coverage.

3. AI stage
- Respect explicit provider selection; do not auto-switch providers.
- On batch AI failure, degrade to rule-based fallback scoring to still generate output.
- Report final scoring mode in summary.

4. Merge stage
- CVE parse failure degrades to standard security entry, no drop.
- Semantic clustering failure keeps CVE-only merges.

5. Output stage
- Always emit valid markdown with `N/A` fallback fields.
- Use temp file + atomic replace for report writes.

## 6. Testing Strategy and Acceptance

### 6.1 Unit tests (bun test)

- `opml/sync`: changed/not changed/network fail/invalid OPML
- `rss/parse`: RSS2/Atom/broken XML/missing dates
- `ai/providers`: request/response contract for 4 providers
- `merge/vuln`: CVE exact merge, no-CVE semantic merge, anti-overmerge checks
- `config`: YAML load/save + CLI precedence

### 6.2 Integration tests

- Run full pipeline with fixed fixture OPML.
- Assert report includes:
  - AI developments section
  - security dynamics section
  - merged vulnerability bulletin with reference links
- Assert balanced topic output (security + AI present).

### 6.3 Regression tests

- Offline with cached OPML still produces report.
- Invalid selected provider call does not switch provider implicitly.
- First run without cache and no network fails with clear guidance.

### 6.4 Definition of Done

- `bun scripts/sec-digest.ts` generates digest under default config.
- Every run performs OPML update check with cached fallback.
- Default provider is openai; gemini/claude/ollama supported.
- YAML config/state under `~/.sec-daily-digest/`.
- Report format and vulnerability merge behavior match target audience needs.

## 7. Initial Config Shape (YAML)

```yaml
provider: openai
opml_profile: tiny
time_range_hours: 48
top_n: 20
output_language: bilingual_zh_en
weights:
  security: 0.5
  ai: 0.5
opml:
  remote_check_url_tiny: "https://raw.githubusercontent.com/zer0yu/CyberSecurityRSS/master/tiny.opml"
  remote_check_url_full: "https://raw.githubusercontent.com/zer0yu/CyberSecurityRSS/master/CyberSecurityRSS.opml"
```

## 8. Skill Output Location Rule

All skill artifacts for this project must stay within:

- `/Users/z3r0yu/z3dev/Skills/sec-daily-digest`

No generated skill files or docs should be written outside this repository unless explicitly requested.
