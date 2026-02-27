import type { VulnerabilityEvent } from "../merge/vuln";

export interface DigestArticle {
  titleZh: string;
  title: string;
  link: string;
  summaryZh: string;
  sourceName: string;
}

export interface DigestRenderInput {
  date: string;
  ai: DigestArticle[];
  security: DigestArticle[];
  vulnerabilities: VulnerabilityEvent[];
}

function renderArticleList(items: DigestArticle[]): string {
  if (items.length === 0) {
    return "_暂无条目_\n";
  }

  return items
    .map((item, index) => {
      let block = `### ${index + 1}. ${item.titleZh}\n\n`;
      block += `[${item.title}](${item.link}) · ${item.sourceName}\n\n`;
      block += `${item.summaryZh}\n`;
      return block;
    })
    .join("\n");
}

function renderVulnEvents(events: VulnerabilityEvent[]): string {
  if (events.length === 0) {
    return "_暂无漏洞事件_\n";
  }

  return events
    .map((event, index) => {
      let block = `### ${index + 1}. ${event.title}\n\n`;
      if (event.cves.length > 0) {
        block += `- CVE: ${event.cves.join(", ")}\n`;
      }
      block += `- 摘要: ${event.summary}\n`;
      block += "- 参考链接:\n";
      for (const ref of event.references) {
        block += `  - ${ref.source}: ${ref.link}\n`;
      }
      return block;
    })
    .join("\n");
}

export function renderDigest(input: DigestRenderInput): string {
  let out = `# sec-daily-digest ${input.date}\n\n`;
  out += "面向网络空间安全研究员的每日精选：平衡追踪 AI 发展与安全动态。\n\n";

  out += "## AI发展\n\n";
  out += renderArticleList(input.ai);
  out += "\n";

  out += "## 安全动态\n\n";
  out += renderArticleList(input.security);
  out += "\n";

  out += "## 漏洞专报\n\n";
  out += renderVulnEvents(input.vulnerabilities);
  out += "\n";

  return out;
}
