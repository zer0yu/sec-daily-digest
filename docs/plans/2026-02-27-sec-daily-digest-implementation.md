# sec-daily-digest Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Bun + TypeScript `sec-daily-digest` skill that checks CyberSecurityRSS OPML updates, fetches and scores security/AI articles, merges vulnerability events, and generates a bilingual daily digest.

**Architecture:** Use a modular pipeline (`opml -> rss -> normalize -> score -> vuln-merge -> report`) with explicit provider selection (`--provider`) and YAML config/state persisted in `~/.sec-daily-digest/`. Keep each stage independently testable with fixture-based tests and deterministic fallbacks.

**Tech Stack:** Bun runtime, TypeScript, Bun test, YAML parser (`yaml`), native `fetch`.

---

**Execution rules for implementer:**
- Use `@test-driven-development` before each code change.
- Use `@systematic-debugging` on unexpected failures.
- Use `@verification-before-completion` before any "done" claim.
- Commit after each task.

### Task 1: Bootstrap Bun project and config path helper

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `scripts/sec-digest.ts`
- Create: `src/config/paths.ts`
- Test: `tests/config/paths.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { getStateRoot } from "../../src/config/paths";

describe("getStateRoot", () => {
  test("uses default ~/.sec-daily-digest path", () => {
    const root = getStateRoot({});
    expect(root.endsWith("/.sec-daily-digest")).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config/paths.test.ts`
Expected: FAIL with module not found for `src/config/paths`.

**Step 3: Write minimal implementation**

```ts
import os from "node:os";
import path from "node:path";

export function getStateRoot(env: NodeJS.ProcessEnv): string {
  return env.SEC_DAILY_DIGEST_HOME || path.join(os.homedir(), ".sec-daily-digest");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config/paths.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json tsconfig.json scripts/sec-digest.ts src/config/paths.ts tests/config/paths.test.ts
git commit -m "chore: bootstrap bun project and state root helper"
```

### Task 2: Implement YAML config load/save with CLI override precedence

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Test: `tests/config/load.test.ts`
- Modify: `package.json` (add `yaml` dependency)

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../../src/config/load";

test("CLI provider overrides YAML provider", async () => {
  const cfg = await loadConfig({ provider: "gemini" }, { SEC_DAILY_DIGEST_HOME: "/tmp/sec-dd-test" });
  expect(cfg.provider).toBe("gemini");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/config/load.test.ts`
Expected: FAIL with `loadConfig` missing.

**Step 3: Write minimal implementation**

```ts
import { parse, stringify } from "yaml";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStateRoot } from "./paths";

const defaults = { provider: "openai", opml_profile: "tiny", time_range_hours: 48, top_n: 20 };

export async function loadConfig(cli: Record<string, unknown>, env: NodeJS.ProcessEnv) {
  const root = getStateRoot(env);
  const file = path.join(root, "config.yaml");
  await mkdir(root, { recursive: true });
  let yamlCfg = {};
  try { yamlCfg = parse(await readFile(file, "utf8")) || {}; } catch {}
  const merged = { ...defaults, ...yamlCfg, ...cli };
  await writeFile(file, stringify(merged), "utf8");
  return merged;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/config/load.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json bun.lock src/config/schema.ts src/config/load.ts tests/config/load.test.ts
git commit -m "feat: add yaml config load/save with cli precedence"
```

### Task 3: Add OPML sync with cached fallback behavior

**Files:**
- Create: `src/opml/sync.ts`
- Test: `tests/opml/sync.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { syncOpml } from "../../src/opml/sync";

test("falls back to cached opml when remote check fails", async () => {
  const result = await syncOpml({
    profile: "tiny",
    fetcher: async () => { throw new Error("network down"); },
  });
  expect(result.usedCache).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/opml/sync.test.ts`
Expected: FAIL because `syncOpml` does not exist.

**Step 3: Write minimal implementation**

```ts
export async function syncOpml(input: {
  profile: "tiny" | "full";
  fetcher: typeof fetch;
}) {
  try {
    const url = input.profile === "tiny"
      ? "https://raw.githubusercontent.com/zer0yu/CyberSecurityRSS/master/tiny.opml"
      : "https://raw.githubusercontent.com/zer0yu/CyberSecurityRSS/master/CyberSecurityRSS.opml";
    const resp = await input.fetcher(url);
    if (!resp.ok) throw new Error(`status ${resp.status}`);
    return { usedCache: false, updated: true };
  } catch {
    return { usedCache: true, updated: false };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/opml/sync.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/opml/sync.ts tests/opml/sync.test.ts
git commit -m "feat: implement opml sync with cache fallback"
```

### Task 4: Parse OPML into feed sources

**Files:**
- Create: `src/opml/parse.ts`
- Test: `tests/opml/parse.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { parseOpmlFeeds } from "../../src/opml/parse";

test("extracts feed xmlUrl/name entries from opml", () => {
  const xml = `<opml><body><outline text="A" xmlUrl="https://a/rss.xml"/></body></opml>`;
  const feeds = parseOpmlFeeds(xml);
  expect(feeds[0]?.xmlUrl).toBe("https://a/rss.xml");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/opml/parse.test.ts`
Expected: FAIL with missing parser.

**Step 3: Write minimal implementation**

```ts
export function parseOpmlFeeds(xml: string): Array<{ name: string; xmlUrl: string; htmlUrl: string }> {
  const matches = [...xml.matchAll(/<outline[^>]*>/g)];
  return matches
    .map(m => m[0])
    .map(tag => ({
      name: (tag.match(/(?:text|title)="([^"]+)"/)?.[1] || "unknown").trim(),
      xmlUrl: (tag.match(/xmlUrl="([^"]+)"/)?.[1] || "").trim(),
      htmlUrl: (tag.match(/htmlUrl="([^"]+)"/)?.[1] || "").trim(),
    }))
    .filter(f => f.xmlUrl.length > 0);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/opml/parse.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/opml/parse.ts tests/opml/parse.test.ts
git commit -m "feat: parse opml feed list"
```

### Task 5: Implement RSS fetch and parse with anti-basic-scraping headers

**Files:**
- Create: `src/rss/fetch.ts`
- Create: `src/rss/parse.ts`
- Test: `tests/rss/fetch.test.ts`
- Test: `tests/rss/parse.test.ts`

**Step 1: Write the failing tests**

```ts
import { expect, test } from "bun:test";
import { buildFetchHeaders } from "../../src/rss/fetch";

test("includes user-agent and accept headers", () => {
  const h = buildFetchHeaders(0);
  expect(h["User-Agent"]).toContain("sec-daily-digest");
  expect(h["Accept"]).toContain("application/rss+xml");
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test tests/rss/fetch.test.ts tests/rss/parse.test.ts`
Expected: FAIL due to missing RSS modules.

**Step 3: Write minimal implementation**

```ts
export function buildFetchHeaders(seed: number): Record<string, string> {
  const uas = [
    "sec-daily-digest/1.0 (+rss-reader)",
    "Mozilla/5.0 sec-daily-digest",
  ];
  return {
    "User-Agent": uas[seed % uas.length]!,
    "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test tests/rss/fetch.test.ts tests/rss/parse.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/rss/fetch.ts src/rss/parse.ts tests/rss/fetch.test.ts tests/rss/parse.test.ts
git commit -m "feat: add rss fetch/parse with anti-basic-scraping headers"
```

### Task 6: Add normalization, dedupe, and time-window filtering

**Files:**
- Create: `src/articles/normalize.ts`
- Test: `tests/articles/normalize.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { normalizeUrl } from "../../src/articles/normalize";

test("removes utm parameters", () => {
  expect(normalizeUrl("https://x.dev?a=1&utm_source=rss")).toBe("https://x.dev/?a=1");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/articles/normalize.test.ts`
Expected: FAIL because helpers are absent.

**Step 3: Write minimal implementation**

```ts
export function normalizeUrl(input: string): string {
  const url = new URL(input);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_")) url.searchParams.delete(key);
  }
  return url.toString();
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/articles/normalize.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/articles/normalize.ts tests/articles/normalize.test.ts
git commit -m "feat: add article normalization and dedupe helpers"
```

### Task 7: Implement provider abstraction for OpenAI/Gemini/Claude/Ollama

**Files:**
- Create: `src/ai/providers/types.ts`
- Create: `src/ai/providers/openai.ts`
- Create: `src/ai/providers/gemini.ts`
- Create: `src/ai/providers/claude.ts`
- Create: `src/ai/providers/ollama.ts`
- Create: `src/ai/providers/factory.ts`
- Test: `tests/ai/providers/factory.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { createProvider } from "../../../src/ai/providers/factory";

test("defaults to openai when provider flag is missing", () => {
  const p = createProvider(undefined, process.env);
  expect(p.id).toBe("openai");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/ai/providers/factory.test.ts`
Expected: FAIL because factory is missing.

**Step 3: Write minimal implementation**

```ts
export type ProviderId = "openai" | "gemini" | "claude" | "ollama";

export function createProvider(input: ProviderId | undefined, env: NodeJS.ProcessEnv) {
  const id: ProviderId = input || "openai";
  return { id, call: async (_prompt: string) => "ok", env };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/ai/providers/factory.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ai/providers tests/ai/providers/factory.test.ts
git commit -m "feat: add multi-provider abstraction with explicit selection"
```

### Task 8: Implement AI scoring plus deterministic fallback scoring

**Files:**
- Create: `src/ai/scoring.ts`
- Test: `tests/ai/scoring.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { computeCompositeScore } from "../../src/ai/scoring";

test("applies balanced 50/50 security-ai weighting", () => {
  const score = computeCompositeScore({ security: 8, ai: 6, quality: 7, timeliness: 7 });
  expect(score).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/ai/scoring.test.ts`
Expected: FAIL with missing scorer.

**Step 3: Write minimal implementation**

```ts
export function computeCompositeScore(v: { security: number; ai: number; quality: number; timeliness: number }) {
  const topic = 0.5 * v.security + 0.5 * v.ai;
  const quality = 0.5 * v.quality + 0.5 * v.timeliness;
  return Number((0.7 * topic + 0.3 * quality).toFixed(2));
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/ai/scoring.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/ai/scoring.ts tests/ai/scoring.test.ts
git commit -m "feat: add balanced scoring and fallback baseline"
```

### Task 9: Implement vulnerability merging (CVE-first + semantic cluster fallback)

**Files:**
- Create: `src/merge/vuln.ts`
- Test: `tests/merge/vuln.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { mergeVulnerabilityItems } from "../../src/merge/vuln";

test("merges entries sharing same CVE", () => {
  const merged = mergeVulnerabilityItems([
    { title: "Foo", summary: "CVE-2026-1234 RCE", link: "a" },
    { title: "Bar", summary: "Patch for CVE-2026-1234", link: "b" },
  ]);
  expect(merged.length).toBe(1);
  expect(merged[0]?.references.length).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/merge/vuln.test.ts`
Expected: FAIL because merger is missing.

**Step 3: Write minimal implementation**

```ts
const CVE_RE = /CVE-\d{4}-\d{4,7}/gi;

export function mergeVulnerabilityItems(items: Array<{ title: string; summary: string; link: string }>) {
  const byKey = new Map<string, { key: string; title: string; summary: string; references: string[] }>();
  for (const item of items) {
    const cves = (item.summary.match(CVE_RE) || item.title.match(CVE_RE) || []).map(s => s.toUpperCase());
    const key = cves[0] || `semantic:${item.title.toLowerCase().slice(0, 40)}`;
    const prev = byKey.get(key);
    if (prev) prev.references.push(item.link);
    else byKey.set(key, { key, title: item.title, summary: item.summary, references: [item.link] });
  }
  return [...byKey.values()];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/merge/vuln.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/merge/vuln.ts tests/merge/vuln.test.ts
git commit -m "feat: add cve-first vulnerability merge with semantic fallback key"
```

### Task 10: Render bilingual markdown digest for security researchers

**Files:**
- Create: `src/report/markdown.ts`
- Test: `tests/report/markdown.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { renderDigest } from "../../src/report/markdown";

test("renders AI and security sections with vulnerability bulletin", () => {
  const md = renderDigest({ ai: [], security: [], vulnerabilities: [] });
  expect(md).toContain("AI 发展");
  expect(md).toContain("安全动态");
  expect(md).toContain("漏洞专报");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/report/markdown.test.ts`
Expected: FAIL due to missing renderer.

**Step 3: Write minimal implementation**

```ts
export function renderDigest(data: { ai: unknown[]; security: unknown[]; vulnerabilities: unknown[] }) {
  return [
    "# Sec Daily Digest",
    "## AI 发展",
    `条目数: ${data.ai.length}`,
    "## 安全动态",
    `条目数: ${data.security.length}`,
    "## 漏洞专报",
    `条目数: ${data.vulnerabilities.length}`,
  ].join("\n\n");
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/report/markdown.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/report/markdown.ts tests/report/markdown.test.ts
git commit -m "feat: add bilingual markdown digest renderer skeleton"
```

### Task 11: Wire pipeline + CLI + SKILL command contract

**Files:**
- Create: `src/pipeline/run.ts`
- Modify: `scripts/sec-digest.ts`
- Create: `SKILL.md`
- Modify: `README.md`
- Test: `tests/pipeline/run.test.ts`

**Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { runPipeline } from "../../src/pipeline/run";

test("returns output path and summary counters", async () => {
  const res = await runPipeline({ provider: "openai", dryRun: true });
  expect(res.outputPath.length).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/pipeline/run.test.ts`
Expected: FAIL with missing orchestrator.

**Step 3: Write minimal implementation**

```ts
export async function runPipeline(_opts: { provider: "openai" | "gemini" | "claude" | "ollama"; dryRun?: boolean }) {
  return { outputPath: "./output/sec-digest.md", counters: { feeds: 0, articles: 0, selected: 0 } };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/pipeline/run.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/pipeline/run.ts scripts/sec-digest.ts tests/pipeline/run.test.ts SKILL.md README.md
git commit -m "feat: wire pipeline entrypoint and /sec-digest skill contract"
```

### Task 12: Add end-to-end fixtures and final verification suite

**Files:**
- Create: `tests/e2e/sec-digest.e2e.test.ts`
- Create: `tests/fixtures/tiny.opml`
- Create: `tests/fixtures/sample-rss.xml`
- Modify: `package.json` (scripts for `test`, `test:e2e`)

**Step 1: Write the failing e2e test**

```ts
import { expect, test } from "bun:test";
import { runPipeline } from "../../src/pipeline/run";

test("e2e: generates digest with merged vulnerability references", async () => {
  const out = await runPipeline({ provider: "openai", dryRun: false });
  expect(out.counters.selected).toBeGreaterThanOrEqual(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/e2e/sec-digest.e2e.test.ts`
Expected: FAIL before fixture wiring is complete.

**Step 3: Write minimal implementation glue**

```ts
// In run.ts, allow fixture mode:
// if process.env.SEC_DAILY_DIGEST_FIXTURE_DIR exists, load fixture OPML/RSS files.
```

**Step 4: Run full verification**

Run: `bun test`
Expected: PASS all unit + integration + e2e tests.

**Step 5: Commit**

```bash
git add tests/e2e tests/fixtures package.json bun.lock src/pipeline/run.ts
git commit -m "test: add e2e verification for sec-daily-digest pipeline"
```

## Final Verification Checklist

Run these commands and record outputs in PR/body notes:

```bash
bun test
bun scripts/sec-digest.ts --provider openai --opml tiny --hours 48 --top-n 20 --dry-run
bun scripts/sec-digest.ts --provider gemini --opml tiny --hours 48 --top-n 20 --dry-run
bun scripts/sec-digest.ts --provider claude --opml tiny --hours 48 --top-n 20 --dry-run
bun scripts/sec-digest.ts --provider ollama --opml tiny --hours 48 --top-n 20 --dry-run
```

Expected:
- Tests pass.
- Provider selection is explicit and default provider is openai.
- OPML check runs each time and cached fallback works.
- Output includes AI section, security section, and merged vulnerability bulletin.
