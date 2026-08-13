import { CheerioCrawler, RequestQueue, EnqueueStrategy, NonRetryableError, RetryRequestError, log, LogLevel } from "crawlee"
import type { CheerioCrawlingContext } from "crawlee"
import { CRAWL_DEFAULTS, CRAWL_LIMITS, HTML_MAX_BYTES, TEXT_MAX_BYTES, METADATA_MAX_LINKS, METADATA_MAX_HEADINGS, METADATA_MAX_HEADING_LENGTH, isPrivateNetworkAllowed } from "@/lib/lead-engine/crawler/defaults"
import { ErrorCategory } from "@/lib/lead-engine/error-categories"
import type { CrawledPage, CrawlEvent, CrawlInput, CrawlResult, WebCrawler } from "@/lib/lead-engine/crawler/types"
import { createRobotsChecker } from "@/lib/lead-engine/crawler/robots"
import { createSsrFGuard, isDomainAllowed, normalizeUrl, resolveUrl } from "@/lib/lead-engine/crawler/urls"

// Opinionated stop: Crawlee's own logging is noisy for an internal tool.
log.setLevel(LogLevel.WARNING)

class RobotsBlockedError extends NonRetryableError {
  constructor(url: string) {
    super(`URL disallowed by robots.txt: ${url}`)
    this.name = "RobotsBlockedError"
  }
}

class SsrfBlockedError extends NonRetryableError {
  constructor(reason: string) {
    super(`Blocked suspect network target: ${reason}`)
    this.name = "SsrfBlockedError"
  }
}

class RunCancelledError extends NonRetryableError {
  constructor() {
    super("Run cancelled")
    this.name = "RunCancelledError"
  }
}

interface CrawlSession {
  stopped: boolean
  pagesDiscovered: number
  pagesQueued: number
  pagesProcessed: number
  pagesSucceeded: number
  pagesFailed: number
  pagesSkipped: number
  failedUrls: string[]
}

const activeCrawls = new Map<string, CrawlSession>()

interface ResolvedCrawlConfig {
  maxPages: number
  maxDepth: number
  concurrency: { min: number; max: number }
  requestTimeoutMs: number
  allowedDomains?: string[]
  respectRobotsTxt: boolean
  delayMs: number
  requestsPerMinute?: number
  userAgent: string
  maxRedirects: number
  allowPrivateNetwork: boolean
}

function clamp(value: number | undefined, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  return Math.min(max, Math.max(min, Math.round(value)))
}

function resolveConfig(input: CrawlInput): ResolvedCrawlConfig {
  const concurrency = {
    min: clamp(input.concurrency?.min, 1, CRAWL_LIMITS.concurrencyMinMax) ?? CRAWL_DEFAULTS.concurrencyMin,
    max: clamp(input.concurrency?.max, 1, CRAWL_LIMITS.concurrencyMinMax) ?? CRAWL_DEFAULTS.concurrencyMax,
  }
  if (concurrency.min > concurrency.max) concurrency.max = concurrency.min
  const requestsPerSecond = input.rateLimit?.requestsPerSecond
  const delayMs = input.rateLimit?.delayMs
  return {
    maxPages: clamp(input.maxPages, 1, CRAWL_LIMITS.maxPagesMax) ?? CRAWL_DEFAULTS.maxPages,
    maxDepth: clamp(input.maxDepth, 0, CRAWL_LIMITS.maxDepthMax) ?? CRAWL_DEFAULTS.maxDepth,
    concurrency,
    requestTimeoutMs: clamp(input.requestTimeoutMs, 1000, CRAWL_LIMITS.requestTimeoutMsMax) ?? CRAWL_DEFAULTS.requestTimeoutMs,
    allowedDomains: input.allowedDomains,
    respectRobotsTxt: input.respectRobotsTxt ?? CRAWL_DEFAULTS.respectRobotsTxt,
    delayMs: delayMs === undefined ? 0 : clamp(Math.round(delayMs), 0, 120_000) ?? 0,
    requestsPerMinute: requestsPerSecond === undefined ? undefined : Math.max(1, Math.round(requestsPerSecond * 60)),
    userAgent: input.userAgent?.trim() || "StartupLeadEngineBot/1.0",
    maxRedirects: CRAWL_DEFAULTS.maxRedirects,
    allowPrivateNetwork: isPrivateNetworkAllowed(),
  }
}

function emit(input: CrawlInput, event: CrawlEvent): void {
  try {
    void input.onEvent?.(event)
  } catch {
    console.log(`scraper.event.drop runId=${input.runId}`)
  }
}

const HTML_CONTENT_TYPES = /^(text\/html|application\/xhtml\+xml)/i

function categorizeError(error: unknown): { category: ErrorCategory; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof RobotsBlockedError) return { category: ErrorCategory.ROBOTS_BLOCKED, message: message.replace(/^URL disallowed by robots.txt: /, "") }
  if (error instanceof SsrfBlockedError) return { category: ErrorCategory.SSRF_BLOCKED, message: message.replace(/^Blocked suspect network target: /, "") }
  if (error instanceof RunCancelledError) return { category: ErrorCategory.CANCELLED, message: "Run cancelled" }
  if (/timeout|timed out|etimedout/i.test(message)) return { category: ErrorCategory.TIMEOUT, message }
  const status = retryRequestedWithStatus(error)
  if (status) return statusCategory(status)
  if (error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string") return { category: ErrorCategory.NETWORK_ERROR, message }
  return { category: ErrorCategory.UNKNOWN, message }
}

function retryRequestedWithStatus(error: unknown): number | undefined {
  if (error instanceof RetryRequestError && "httpStatus" in error) {
    const status = (error as { httpStatus?: unknown }).httpStatus
    if (typeof status === "number") return status
  }
  return undefined
}

function statusCategory(status: number): { category: ErrorCategory; message: string } {
  if (status === 429) return { category: ErrorCategory.RATE_LIMITED, message: `HTTP ${status}` }
  if (status === 408) return { category: ErrorCategory.TIMEOUT, message: `HTTP ${status}` }
  return { category: ErrorCategory.HTTP_ERROR, message: `HTTP ${status}` }
}

export const crawleeWebCrawler: WebCrawler = {
  cancel(runId: string): void {
    const session = activeCrawls.get(runId)
    if (session) session.stopped = true
  },

  async crawl(input: CrawlInput): Promise<CrawlResult> {
    const config = resolveConfig(input)
    const guard = createSsrFGuard()
    const robotsAllow = createRobotsChecker(guard, config.userAgent)
    const session: CrawlSession = { stopped: false, pagesDiscovered: 0, pagesQueued: 0, pagesProcessed: 0, pagesSucceeded: 0, pagesFailed: 0, pagesSkipped: 0, failedUrls: [] }
    activeCrawls.set(input.runId, session)
    const startedAt = Date.now()

    const startUrls = input.startUrls
      .map(normalizeUrl)
      .filter((url): url is string => url !== null && isDomainAllowed(url, config.allowedDomains))

    // Per-run queue so sequential/concurrent crawls never share state
    // (Crawlee persists its default queue to ./storage across runs).
    const requestQueue = await RequestQueue.open(`run-${input.runId}`)

    try {
      const crawler = new CheerioCrawler(
        {
          requestQueue,
          requestHandlerTimeoutSecs: Math.ceil(config.requestTimeoutMs / 1000) + 5,
          navigationTimeoutSecs: Math.ceil(config.requestTimeoutMs / 1000),
          maxRequestRetries: CRAWL_DEFAULTS.maxRetries,
          retryOnBlocked: false,
          maxRequestsPerCrawl: config.maxPages,
          maxCrawlDepth: config.maxDepth,
          minConcurrency: config.concurrency.min,
          maxConcurrency: config.concurrency.max,
          useSessionPool: false,
          respectRobotsTxtFile: false,
          ...(config.requestsPerMinute ? { maxRequestsPerMinute: config.requestsPerMinute } : {}),
          ...(config.delayMs ? { sameDomainDelaySecs: config.delayMs / 1000 } : {}),

          preNavigationHooks: [
            async ({ request }, gotOptions) => {
              gotOptions.headers = { ...gotOptions.headers, "user-agent": config.userAgent }
              if (session.stopped) throw new RunCancelledError()
              if (!config.allowPrivateNetwork) {
                const safe = await guard.checkUrl(request.url)
                if (!safe.ok) throw new SsrfBlockedError(safe.reason ?? request.url)
                gotOptions.dnsLookup = guard.safeLookup
                gotOptions.maxRedirects = config.maxRedirects
              }
              if (config.respectRobotsTxt && !(await robotsAllow(request.url))) throw new RobotsBlockedError(request.url)
            },
          ],

          onSkippedRequest: async ({ url, reason }) => {
            if (session.stopped) return
            session.pagesSkipped++
            if (reason === "robotsTxt") {
              emit(input, { level: "WARNING", category: ErrorCategory.ROBOTS_BLOCKED, url, message: `Robots blocked: ${url}` })
            }
          },

          failedRequestHandler: async ({ request, error }) => {
            if (session.stopped) return
            const url = request.url
            session.pagesFailed++
            session.failedUrls.push(url)
            const { category, message } = categorizeError(error)
            emit(input, {
              level: category === ErrorCategory.ROBOTS_BLOCKED ? "WARNING" : "ERROR",
              category,
              url,
              message: `${message}${request.retryCount > 0 ? ` (after ${request.retryCount} retries)` : ""}`,
            })
            await persistPage(input, {
              url,
              finalUrl: request.loadedUrl ?? url,
              errorCategory: category,
              metadata: { reason: message, retries: request.retryCount },
              headings: [],
              linksFound: 0,
              linksEnqueued: [],
              retries: request.retryCount,
              fetchedAt: new Date(),
            })
          },

          requestHandler: async (context) => {
            if (session.stopped) return
            session.pagesProcessed++
            const { request, response } = context
            const url = request.url
            const finalUrl = request.loadedUrl ?? url
            const statusCode = response?.statusCode ?? 0

            const safeFinal = config.allowPrivateNetwork || (await guard.checkUrl(finalUrl)).ok
            if (!safeFinal) {
              session.pagesFailed++
              session.failedUrls.push(url)
              emit(input, { level: "ERROR", category: ErrorCategory.SSRF_BLOCKED, url, message: `SSRF blocked: ${finalUrl}` })
              await persistPage(input, {
                url,
                finalUrl,
                statusCode,
                errorCategory: ErrorCategory.SSRF_BLOCKED,
                metadata: { reason: `final URL blocked: ${finalUrl}` },
                headings: [],
                linksFound: 0,
                linksEnqueued: [],
                retries: request.retryCount,
                fetchedAt: new Date(),
              })
              return
            }

            if (statusCode >= 500 || statusCode === 429 || statusCode === 408) {
              const error = new RetryRequestError(`HTTP ${statusCode}`)
              ;(error as { httpStatus?: number }).httpStatus = statusCode
              throw error
            }
            if (statusCode < 200 || statusCode >= 300) {
              session.pagesFailed++
              session.failedUrls.push(url)
              emit(input, { level: "ERROR", category: ErrorCategory.HTTP_ERROR, url, message: `HTTP ${statusCode}: ${url}` })
              await persistPage(input, {
                url,
                finalUrl,
                statusCode,
                errorCategory: ErrorCategory.HTTP_ERROR,
                metadata: { httpStatus: statusCode },
                headings: [],
                linksFound: 0,
                linksEnqueued: [],
                retries: request.retryCount,
                fetchedAt: new Date(),
              })
              return
            }

            const contentType = context.contentType?.type ?? ""
            if (contentType && !HTML_CONTENT_TYPES.test(contentType)) {
              session.pagesSkipped++
              emit(input, { level: "INFO", category: ErrorCategory.UNSUPPORTED_CONTENT, url, message: `Skipped ${contentType.split(";")[0].trim()}: ${url}` })
              return
            }
            if (!context.$) {
              session.pagesFailed++
              session.failedUrls.push(url)
              emit(input, { level: "ERROR", category: ErrorCategory.PARSE_ERROR, url, message: `Failed to parse HTML: ${url}` })
              await persistPage(input, {
                url,
                finalUrl,
                statusCode,
                errorCategory: ErrorCategory.PARSE_ERROR,
                metadata: { httpStatus: statusCode },
                headings: [],
                linksFound: 0,
                linksEnqueued: [],
                retries: request.retryCount,
                fetchedAt: new Date(),
              })
              return
            }

            const page = await buildPage(context, input, config, robotsAllow)
            session.pagesSucceeded++
            await persistPage(input, page)
            if (page.linksEnqueued.length > 0) {
              session.pagesQueued += page.linksEnqueued.length
              try {
                await context.enqueueLinks({ urls: page.linksEnqueued, strategy: EnqueueStrategy.All })
              } catch (e) {
                emit(input, {
                  level: "WARNING",
                  category: ErrorCategory.UNKNOWN,
                  message: `Failed to enqueue links: ${e instanceof Error ? e.message : "unknown error"}`,
                })
              }
            }
          },
        },
      )

      await crawler.run(startUrls.map((url) => ({ url })))

      return {
        pagesDiscovered: session.pagesDiscovered,
        pagesQueued: session.pagesQueued,
        pagesProcessed: session.pagesProcessed,
        pagesSucceeded: session.pagesSucceeded,
        pagesFailed: session.pagesFailed,
        pagesSkipped: session.pagesSkipped,
        recordsExtracted: session.pagesSucceeded,
        failedUrls: session.failedUrls,
        durationMs: Date.now() - startedAt,
        cancelled: session.stopped,
      }
    } finally {
      activeCrawls.delete(input.runId)
      await requestQueue.drop()
    }
  },
}

async function buildPage(
  context: CheerioCrawlingContext,
  input: CrawlInput,
  config: ResolvedCrawlConfig,
  robotsAllow: (url: string) => Promise<boolean>,
): Promise<CrawledPage> {
  const { request, response } = context
  const url = request.url
  const finalUrl = request.loadedUrl ?? url
  const statusCode = response?.statusCode ?? 200
  const cheerio = context.$

  const rawHtml = cheerio.html()
  const truncatedHtml = rawHtml !== null && rawHtml.length > HTML_MAX_BYTES
  const html = truncatedHtml ? rawHtml.slice(0, HTML_MAX_BYTES) : rawHtml

  cheerio("script, style, noscript, svg").remove()
  let textContent = cheerio("body").text().replace(/\s+/g, " ").trim()
  const truncatedText = textContent.length > TEXT_MAX_BYTES
  if (truncatedText) textContent = textContent.slice(0, TEXT_MAX_BYTES)

  const title = (cheerio("title").first().text().trim().slice(0, 500) || undefined)
  const description = (cheerio('meta[name="description"]').first().attr("content")?.trim().slice(0, 500) || undefined)
  const canonicalRaw = cheerio('link[rel="canonical"]').first().attr("href")
  const canonicalUrl = canonicalRaw ? normalizeUrl(resolveUrl(canonicalRaw, finalUrl) ?? canonicalRaw) ?? undefined : undefined
  const language = cheerio("html").first().attr("lang")?.slice(0, 50)

  const headings: string[] = []
  for (const el of cheerio("h1, h2, h3").toArray()) {
    const text = cheerio(el).text().replace(/\s+/g, " ").trim()
    if (text) headings.push(text.slice(0, METADATA_MAX_HEADING_LENGTH))
    if (headings.length >= METADATA_MAX_HEADINGS) break
  }

  const seen = new Set<string>()
  const linksEnqueued: string[] = []
  let linksFound = 0
  for (const el of cheerio("a[href]").toArray()) {
    const href = cheerio(el).attr("href")
    if (!href) continue
    const absolute = resolveUrl(href, finalUrl)
    const normalized = absolute ? normalizeUrl(absolute) : null
    if (!normalized) continue
    linksFound++
    if (seen.has(normalized)) continue
    seen.add(normalized)
    if (!isDomainAllowed(normalized, config.allowedDomains)) continue
    if (config.respectRobotsTxt && !(await robotsAllow(normalized))) {
      emit(input, { level: "WARNING", category: ErrorCategory.ROBOTS_BLOCKED, url: normalized, message: `Robots blocked: ${normalized}` })
      continue
    }
    linksEnqueued.push(normalized)
    if (linksEnqueued.length >= METADATA_MAX_LINKS) break
  }

  return {
    url,
    finalUrl,
    statusCode,
    contentType: context.contentType?.type,
    title,
    description,
    canonicalUrl,
    language,
    headings,
    linksFound,
    linksEnqueued,
    textContent: textContent || undefined,
    html: html ?? undefined,
    metadata: {
      pageTooLarge: truncatedHtml,
      textTruncated: truncatedText,
      canonicalUrl,
      language,
      description,
      headings,
      linksFound,
      linksEnqueued,
      retries: request.retryCount,
      depth: (request as unknown as { crawlDepth?: number }).crawlDepth ?? 0,
    },
    retries: request.retryCount,
    fetchedAt: new Date(),
  }
}

async function persistPage(input: CrawlInput, page: CrawledPage): Promise<void> {
  try {
    await input.onPage?.(page)
  } catch {
    emit(input, { level: "ERROR", category: ErrorCategory.UNKNOWN, url: page.url, message: "Failed to persist crawled page" })
  }
}