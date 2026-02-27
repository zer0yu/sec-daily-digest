import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fallbackScoreFromText, inferTopicSignals } from "../ai/scoring";
import { createProvider } from "../ai/providers/factory";
import type { AIProvider } from "../ai/providers/types";
import { dedupeByUrl, filterByHours } from "../articles/normalize";
import { loadConfig } from "../config/load";
import { mergeVulnerabilityItems } from "../merge/vuln";
import { parseOpmlFeeds } from "../opml/parse";
import { syncOpml } from "../opml/sync";
import { renderDigest } from "../report/markdown";
import { fetchAllFeeds, type FeedSource } from "../rss/fetch";
import type { Article } from "../rss/parse";

export interface RunPipelineOptions {
  provider?: "openai" | "gemini" | "claude" | "ollama";
  opmlProfile?: "tiny" | "full";
  hours?: number;
  topN?: number;
  outputPath?: string;
  dryRun?: boolean;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  fetcher?: typeof fetch;
  seedArticles?: Article[];
}

export interface RunPipelineResult {
  outputPath: string;
  counters: {
    feeds: number;
    articles: number;
    recent: number;
    selected: number;
    vulnerabilities: number;
  };
  usedCache: boolean;
  provider: string;
}

interface EnrichedArticle extends Article {
  summaryZh: string;
  titleZh: string;
  signals: {
    security: number;
    ai: number;
  };
  score: number;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function splitByFocus(items: EnrichedArticle[]): { ai: EnrichedArticle[]; security: EnrichedArticle[] } {
  const ai: EnrichedArticle[] = [];
  const security: EnrichedArticle[] = [];

  for (const item of items) {
    if (item.signals.security >= item.signals.ai) {
      security.push(item);
    } else {
      ai.push(item);
    }
  }

  ai.sort((a, b) => b.score - a.score);
  security.sort((a, b) => b.score - a.score);
  return { ai, security };
}

function pickBalanced(items: EnrichedArticle[], topN: number): { ai: EnrichedArticle[]; security: EnrichedArticle[]; selected: EnrichedArticle[] } {
  const { ai, security } = splitByFocus(items);
  const aiQuota = Math.ceil(topN / 2);
  const secQuota = Math.floor(topN / 2);
  const pickedAi = ai.slice(0, aiQuota);
  const pickedSec = security.slice(0, secQuota);
  const selected = [...pickedAi, ...pickedSec];

  if (selected.length < topN) {
    const extras = items
      .filter((item) => !selected.includes(item))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN - selected.length);
    selected.push(...extras);
  }

  const rebucket = splitByFocus(selected);
  return {
    ai: rebucket.ai,
    security: rebucket.security,
    selected,
  };
}

function summarizeZh(article: Article): { titleZh: string; summaryZh: string } {
  const summary = article.description || article.title;
  return {
    titleZh: article.title,
    summaryZh: summary.length > 220 ? `${summary.slice(0, 220)}...` : summary,
  };
}

interface ProviderScoringPayload {
  relevance: number;
  quality: number;
  timeliness: number;
  security: number;
  ai: number;
  title_zh?: string;
  summary_zh?: string;
}

function parseProviderPayload(text: string): ProviderScoringPayload | null {
  let raw = text.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  try {
    const parsed = JSON.parse(raw) as ProviderScoringPayload;
    return parsed;
  } catch {
    return null;
  }
}

function clamp(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)));
}

function buildScoringPrompt(article: Article): string {
  return `你是网络空间安全研究员助手。请对下面文章打分，并返回 JSON。

评分维度（1-10）：
- relevance：总体阅读价值
- quality：信息质量与深度
- timeliness：时效性
- security：安全相关性
- ai：AI 相关性

并补充：
- title_zh：中文标题
- summary_zh：中文摘要（2-3句）

文章标题：${article.title}
链接：${article.link}
来源：${article.sourceName}
正文摘要：${article.description}

仅返回 JSON，不要 markdown：
{
  "relevance": 8,
  "quality": 7,
  "timeliness": 9,
  "security": 8,
  "ai": 7,
  "title_zh": "中文标题",
  "summary_zh": "中文摘要"
}`;
}

async function enrichWithProvider(article: Article, provider: AIProvider): Promise<EnrichedArticle | null> {
  const response = await provider.call(buildScoringPrompt(article));
  const parsed = parseProviderPayload(response);
  if (!parsed) {
    return null;
  }

  const localized = summarizeZh(article);
  const titleZh = parsed.title_zh?.trim() || localized.titleZh;
  const summaryZh = parsed.summary_zh?.trim() || localized.summaryZh;
  const signals = {
    security: clamp(parsed.security),
    ai: clamp(parsed.ai),
  };
  const score = Number(
    (
      0.35 * (0.5 * signals.security + 0.5 * signals.ai) +
      0.35 * (0.5 * clamp(parsed.relevance) + 0.5 * clamp(parsed.quality)) +
      0.3 * clamp(parsed.timeliness)
    ).toFixed(2),
  );

  return {
    ...article,
    titleZh,
    summaryZh,
    signals,
    score,
  };
}

async function loadArticles(options: Required<Pick<RunPipelineOptions, "env">> & {
  profile: "tiny" | "full";
  fetcher: typeof fetch;
  seedArticles?: Article[];
}): Promise<{ articles: Article[]; feedsCount: number; usedCache: boolean }> {
  if (options.seedArticles && options.seedArticles.length > 0) {
    return {
      articles: options.seedArticles,
      feedsCount: 0,
      usedCache: false,
    };
  }

  const syncResult = await syncOpml({
    profile: options.profile,
    env: options.env,
    fetcher: options.fetcher,
  });
  const opmlXml = await readFile(syncResult.opmlPath, "utf8");
  const feeds: FeedSource[] = parseOpmlFeeds(opmlXml);
  const articles = await fetchAllFeeds(feeds, { fetcher: options.fetcher });

  return {
    articles,
    feedsCount: feeds.length,
    usedCache: syncResult.usedCache,
  };
}

export async function runPipeline(options: RunPipelineOptions = {}): Promise<RunPipelineResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();

  const config = await loadConfig(
    {
      provider: options.provider,
      opml_profile: options.opmlProfile,
      time_range_hours: options.hours,
      top_n: options.topN,
    },
    env,
  );

  const articlesResult = await loadArticles({
    env,
    profile: config.opml_profile === "full" ? "full" : "tiny",
    fetcher: options.fetcher ?? fetch,
    seedArticles: options.seedArticles,
  });

  const deduped = dedupeByUrl(articlesResult.articles).map((item) => ({
    ...item,
    link: item.link,
  }));
  const recent = filterByHours(deduped, config.time_range_hours, now);

  let provider: AIProvider | null = null;
  if (!options.dryRun) {
    try {
      provider = createProvider(config.provider, env, options.fetcher ?? fetch);
    } catch (error) {
      console.warn(`[pipeline] provider init failed, using rule fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const scored: EnrichedArticle[] = [];
  for (const article of recent) {
    if (provider) {
      try {
        const enriched = await enrichWithProvider(article, provider);
        if (enriched) {
          scored.push(enriched);
          continue;
        }
      } catch (error) {
        console.warn(`[pipeline] provider scoring failed for ${article.link}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const signals = inferTopicSignals(article.title, article.description);
    const fallback = fallbackScoreFromText(article);
    const localized = summarizeZh(article);
    scored.push({
      ...article,
      titleZh: localized.titleZh,
      summaryZh: localized.summaryZh,
      signals,
      score: fallback.composite,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const balanced = pickBalanced(scored, config.top_n);

  const vulnerabilities = mergeVulnerabilityItems(
    balanced.security
      .filter((item) => item.signals.security >= 6 || /CVE-\d{4}-\d{4,7}/i.test(`${item.title} ${item.description}`))
      .map((item) => ({
        title: item.title,
        summary: item.summaryZh || item.description,
        link: item.link,
        source: item.sourceName,
      })),
  );

  const report = renderDigest({
    date: toDateString(now),
    ai: balanced.ai.map((item) => ({
      titleZh: item.titleZh,
      title: item.title,
      link: item.link,
      summaryZh: item.summaryZh,
      sourceName: item.sourceName,
    })),
    security: balanced.security.map((item) => ({
      titleZh: item.titleZh,
      title: item.title,
      link: item.link,
      summaryZh: item.summaryZh,
      sourceName: item.sourceName,
    })),
    vulnerabilities,
  });

  const outputPath = options.outputPath ?? `./output/sec-digest-${toDateString(now).replace(/-/g, "")}.md`;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, report, "utf8");

  return {
    outputPath,
    counters: {
      feeds: articlesResult.feedsCount,
      articles: articlesResult.articles.length,
      recent: recent.length,
      selected: balanced.selected.length,
      vulnerabilities: vulnerabilities.length,
    },
    usedCache: articlesResult.usedCache,
    provider: config.provider,
  };
}
