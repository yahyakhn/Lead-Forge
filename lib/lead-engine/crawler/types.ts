import type { ErrorCategory } from "@/lib/lead-engine/error-categories"

export interface CrawlRateLimit {
  requestsPerSecond?: number
  delayMs?: number
}

export interface CrawlInput {
  runId: string
  organizationId: string

  startUrls: string[]

  maxPages?: number
  maxDepth?: number

  concurrency?: {
    min: number
    max: number
  }

  requestTimeoutMs?: number

  allowedDomains?: string[]

  respectRobotsTxt?: boolean

  rateLimit?: CrawlRateLimit

  userAgent?: string

  onPage?: (page: CrawledPage) => Promise<void> | void
  onEvent?: (event: CrawlEvent) => Promise<void> | void
}

export interface CrawledPage {
  url: string
  finalUrl: string
  statusCode?: number
  contentType?: string
  errorCategory?: ErrorCategory
  title?: string
  description?: string
  canonicalUrl?: string
  language?: string
  headings: string[]
  linksFound: number
  linksEnqueued: string[]
  textContent?: string
  html?: string
  metadata: Record<string, unknown>
  retries: number
  fetchedAt: Date
}

export interface CrawlResult {
  pagesDiscovered: number
  pagesQueued: number
  pagesProcessed: number
  pagesSucceeded: number
  pagesFailed: number
  pagesSkipped: number
  recordsExtracted: number
  failedUrls: string[]
  durationMs: number
  cancelled: boolean
}

export interface CrawlEvent {
  level: "INFO" | "WARNING" | "ERROR"
  message: string
  category?: ErrorCategory
  url?: string
}

export interface WebCrawler {
  crawl(input: CrawlInput): Promise<CrawlResult>
  cancel(runId: string): void
}