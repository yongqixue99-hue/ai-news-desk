# GitHub news collector options

**Research date:** 2026-08-07  
**Method:** concise review of official project repositories and release pages. Activity, release, and star figures are point-in-time observations as of the research date.

## Findings

### 1. Horizon — strongest pipeline foundation

[Horizon](https://github.com/Thysrael/Horizon) is MIT-licensed, had about **8.7k GitHub stars**, and was last committed to on **2026-08-04**. It already collects from RSS, Hacker News, Reddit, Telegram, Twitter, GitHub, and OpenBB. Its pipeline supports a `--hours N` time window, deduplication, AI scoring/filtering/enrichment, bilingual summaries, Docker deployment, and staged MCP tools with run artifacts.

The missing layer is editorial product workflow: no candidate-selection UI, editable per-story drafts, image workflow, or Xiaoheihe form filling. Horizon is therefore the best engine here, but not a finished newsroom console.

### 2. TrendRadar — capable monitoring, weaker editorial fit

[TrendRadar](https://github.com/sansan0/TrendRadar) is GPL-3.0-licensed and was active on **2026-07-17**. It combines RSS and platform hotlists with visual timeline scheduling, AI filtering and analysis, and MCP access.

It still lacks a complete editorial surface for selecting candidates, editing articles, managing images, and publishing. It is a viable monitoring/reference option, but adopting it would not remove the need to build those layers.

### 3. Miniflux — mature persistent feed store

[Miniflux](https://github.com/miniflux/v2) is Apache-2.0-licensed; [version 2.3.3](https://github.com/miniflux/v2/releases/tag/2.3.3) was released on **2026-07-24**. It offers a REST API, time-based filtering, Readability extraction, and PostgreSQL-backed storage.

This is the most mature option for durable feed ingestion and state, but it provides neither AI processing nor an editorial authoring workflow. It is a useful later addition if persistent-feed robustness becomes more important than minimizing V1 components.

### 4. FreshRSS — ready-made candidate reader

[FreshRSS](https://github.com/FreshRSS/FreshRSS) is AGPL-3.0-licensed; [version 1.29.1](https://github.com/FreshRSS/FreshRSS/releases/tag/1.29.1) was released on **2026-05-20**. It supports SQLite, PostgreSQL, and MySQL, plus filters, extensions, and LLM-assisted classification.

Its existing reader is useful as a candidate-review UI, but it is not an article-production pipeline: draft editing, image production, and destination publishing would remain custom work.

### 5. RSSHub — optional adapter, not the core system

[RSSHub](https://github.com/DIYgod/RSSHub) is AGPL-3.0-licensed and was active on **2026-08-06**. It can normalize sites without official feeds into RSS and is best treated as an optional source adapter upstream of the main collector.

A route's existence does **not** grant permission to reproduce or republish its content. Each source still requires a rights, terms, attribution, and excerpt-length review.

### 6. NewsNow — useful UI reference only

[NewsNow](https://github.com/ourongxing/newsnow) is MIT-licensed and provides a hot-news UI, MCP support, and code-defined custom sources. Its README describes the project as a demo and says a new version is coming, so it should not be the core production dependency.

### 7. General workflow engines

[n8n](https://github.com/n8n-io/n8n) and [Huginn](https://github.com/huginn/huginn) can schedule and connect ingestion, transformation, and notification steps. They are workflow engines, not editorial consoles; either would still need a separate candidate dashboard, draft editor, image workflow, and publishing interface.

### 8. Agent Skill availability and limits

No mature end-to-end Agent Skill was found for this complete news-desk workflow. Installed **Defuddle**, **imagegen**, and **Chrome/browser-control** capabilities are reusable components for article extraction, image generation, and browser-assisted form interaction.

An Agent Skill is instructions and orchestration. It does not itself provide a persistent scheduler, database, or GUI, so packaging the workflow as a skill cannot replace the service and editorial-console layers.

## Recommendation

The least-custom V1 is:

```text
official RSS/API + optional RSSHub
              -> Horizon pipeline engine
              -> thin local SQLite editorial console
              -> image module
              -> browser helper for destination form filling
```

This reuses Horizon's strongest ingestion and AI stages while limiting custom code to the product-specific editorial experience. Add Miniflux later only if hardened persistent feed storage, unread state, and recovery justify the extra service.

A faster chat-only prototype could combine **Horizon MCP** with a custom **news-desk Agent Skill**. That would validate source collection, filtering, enrichment, and draft generation, but it cannot provide the requested slider/dashboard experience or persistent editorial state.
