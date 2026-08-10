import { prisma } from "@/lib/db"
import { buildWebsiteConfig, type WebsiteConfig } from "@/lib/lead-engine/website-config"
import { CRAWL_DEFAULTS, defaultUserAgent } from "@/lib/lead-engine/crawler/defaults"
import { crawleeWebCrawler } from "@/lib/lead-engine/crawler/crawlee"
import type { CrawledPage, CrawlInput } from "@/lib/lead-engine/crawler/types"
import { addRunEvent } from "@/lib/lead-engine/runs"
import type { ConfigValidation, DiscoveryInput, DiscoveryTarget, LeadSourceAdapter, ScrapeInput, ScrapeResult } from "@/lib/lead-engine/types"
import { LeadSourceType, ScraperRunEventLevel, SourceCapability } from "@/generated/prisma/enums"
import type { Prisma } from "@/generated/prisma/client"

function crawlConfig(config: WebsiteConfig, testMode: boolean): WebsiteConfig {
  if (!testMode) return config
  // Test runs (spec §48) are always small and sequential.
  return {
    ...config,
    maxPages: CRAWL_DEFAULTS.testMaxPages,
    maxDepth: CRAWL_DEFAULTS.testMaxDepth,
    concurrency: { min: 1, max: 1 },
  }
}

export const websiteAdapter: LeadSourceAdapter = {
  id: "website",
  name: "Website Crawler",
  description: "Crawls public website pages with Crawlee (robots.txt, rate limits, depth/page limits, SSRF protection).",
  type: LeadSourceType.WEBSITE,
  capabilities: [SourceCapability.DISCOVERY, SourceCapability.SCRAPING],

  validateConfig(config: unknown): ConfigValidation {
    try {
      buildWebsiteConfig(config)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Invalid configuration" }
    }
  },

  async discover(input: DiscoveryInput): Promise<DiscoveryTarget[]> {
    const config = buildWebsiteConfig(input.config ?? {})
    return config.startUrls.map((url) => ({ type: "URL", value: url }))
  },

  async scrape(input: ScrapeInput): Promise<ScrapeResult> {
    const config = crawlConfig(buildWebsiteConfig(input.config), input.testMode ?? false)
    const { runId, organizationId, source } = input

    let persisted = 0
    const runStats = {
      discovered: 0,
      queued: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    }

    const crawlInput: CrawlInput = {
      runId,
      organizationId,
      startUrls: config.startUrls,
      maxPages: config.maxPages,
      maxDepth: config.maxDepth,
      concurrency: config.concurrency,
      requestTimeoutMs: config.requestTimeoutMs,
      allowedDomains: config.allowedDomains,
      respectRobotsTxt: config.respectRobotsTxt,
      rateLimit: { delayMs: config.delayMs },
      userAgent: defaultUserAgent(),

      onPage: async (page: CrawledPage) => {
        await prisma.rawPage.create({
          data: {
            organizationId,
            runId,
            sourceId: source.id,
            url: page.finalUrl,
            statusCode: page.statusCode ?? null,
            errorCategory: page.errorCategory ?? null,
            title: page.title ?? null,
            contentType: page.contentType ?? null,
            html: page.html ?? null,
            textContent: page.textContent ?? null,
            metadata: page.metadata as Prisma.InputJsonValue,
            fetchedAt: page.fetchedAt,
          },
        })
        persisted++
        // ponytail: coarse heartbeat (every 5 pages) is enough for stale-run detection
        if (persisted % 5 === 0) {
          await prisma.scraperRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
        }
      },

      onEvent: async (event) => {
        await addRunEvent(runId, eventLevel(event.level), event.message, {
          ...(event.category ? { category: event.category } : {}),
          ...(event.url ? { url: event.url } : {}),
        })
      },
    }

    const result = await crawleeWebCrawler.crawl(crawlInput)
    Object.assign(runStats, {
      discovered: result.pagesDiscovered,
      queued: result.pagesQueued,
      processed: result.pagesProcessed,
      succeeded: result.pagesSucceeded,
      failed: result.pagesFailed,
      skipped: result.pagesSkipped,
    })

    const rows = await prisma.rawPage.findMany({
      where: { runId, errorCategory: null },
      select: { url: true, title: true, metadata: true },
      orderBy: { createdAt: "asc" },
    })
    const records = rows.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      return {
        externalId: row.url,
        sourceUrl: row.url,
        data: {
          pageUrl: row.url,
          title: row.title ?? null,
          canonicalUrl: typeof meta.canonicalUrl === "string" ? meta.canonicalUrl : null,
          language: typeof meta.language === "string" ? meta.language : null,
          description: typeof meta.description === "string" ? meta.description : null,
        },
      }
    })

    return {
      records,
      stats: {
        discovered: result.pagesDiscovered || records.length,
        processed: result.pagesProcessed,
        failed: result.pagesFailed,
        pages: runStats,
      },
    }
  },
}

function eventLevel(level: "INFO" | "WARNING" | "ERROR"): ScraperRunEventLevel {
  return level === "ERROR" ? ScraperRunEventLevel.ERROR : level === "WARNING" ? ScraperRunEventLevel.WARNING : ScraperRunEventLevel.INFO
}