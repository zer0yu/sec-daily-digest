import { describe, expect, test } from "bun:test";
import { renderDigest } from "../../src/report/markdown";

describe("renderDigest", () => {
  test("renders key sections for security researchers", () => {
    const markdown = renderDigest({
      date: "2026-02-27",
      highlights: "今日趋势：AI 网关安全成为核心议题。",
      ai: [
        {
          titleZh: "中文标题",
          title: "English title",
          link: "https://example.com/a",
          summaryZh: "中文摘要",
          reasonZh: "推荐理由",
          category: "ai-ml",
          keywords: ["agent"],
          score: 8.5,
          sourceName: "feed-a",
        },
      ],
      security: [],
      vulnerabilities: [
        {
          key: "CVE-2026-12345",
          title: "Major RCE",
          summary: "Impact summary",
          cves: ["CVE-2026-12345"],
          references: [{ source: "feed-a", link: "https://example.com/v1" }],
        },
      ],
    });

    expect(markdown).toContain("## AI发展");
    expect(markdown).toContain("## 安全动态");
    expect(markdown).toContain("## 📝 今日趋势");
    expect(markdown).toContain("## 漏洞专报");
    expect(markdown).toContain("CVE-2026-12345");
    expect(markdown).toContain("[English title](https://example.com/a)");
  });
});
