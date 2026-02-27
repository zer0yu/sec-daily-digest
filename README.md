# sec-daily-digest

`sec-daily-digest` 从 CyberSecurityRSS 抓取最新文章，按安全与 AI 的均衡策略筛选，自动聚合漏洞事件并生成每日精选 Markdown 日报。

## 特性

- TypeScript + Bun 运行时
- 每次运行前检查 `tiny.opml` 更新（可切换完整 OPML）
- 默认使用 OpenAI API 格式，同时支持 Gemini / Claude / Ollama
- 漏洞合并策略：
  - 优先按 `CVE-ID` 合并
  - 无 `CVE-ID` 的重大漏洞按语义聚类合并
  - 合并事件罗列全部参考链接
- 输出为中英混合阅读格式（中文标题与摘要 + 英文原题链接）

## 配置目录（YAML）

固定目录：

- `~/.sec-daily-digest/`

关键文件：

- `~/.sec-daily-digest/config.yaml`
- `~/.sec-daily-digest/opml/tiny.opml`
- `~/.sec-daily-digest/opml/CyberSecurityRSS.opml`

## 快速开始

1) 安装依赖

```bash
bun install
```

2) 运行

```bash
bun scripts/sec-digest.ts \
  --provider openai \
  --opml tiny \
  --hours 48 \
  --top-n 20 \
  --output ./output/sec-digest-$(date +%Y%m%d).md
```

## 参数

- `--provider <openai|gemini|claude|ollama>`：显式选择 provider，默认 `openai`
- `--opml <tiny|full>`：默认 `tiny`
- `--hours <n>`：时间窗（小时），默认 `48`
- `--top-n <n>`：精选数量，默认 `20`
- `--output <path>`：输出路径
- `--dry-run`：仅规则评分，不调用外部 AI

## 环境变量

OpenAI（默认）：

- `OPENAI_API_KEY`
- `OPENAI_API_BASE`（可选）
- `OPENAI_MODEL`（可选）

Gemini：

- `GEMINI_API_KEY`
- `GEMINI_MODEL`（可选）

Claude：

- `ANTHROPIC_API_KEY`
- `CLAUDE_MODEL`（可选）
- `CLAUDE_API_BASE`（可选）

Ollama：

- `OLLAMA_API_BASE`（可选，默认 `http://127.0.0.1:11434`）
- `OLLAMA_MODEL`（可选）

## 测试

```bash
bun test
```

## Skill Command

作为 skill 使用时，触发命令为：

```text
/sec-digest
```
