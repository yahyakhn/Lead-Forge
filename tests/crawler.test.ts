import { afterAll, describe, expect, it } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { crawleeWebCrawler } from "@/lib/lead-engine/crawler/crawlee"
import { createSsrFGuard } from "@/lib/lead-engine/crawler/urls"
import type { CrawlEvent, CrawlInput } from "@/lib/lead-engine/crawler/types"

const orgId = "crawler-test-org"
const events: CrawlEvent[] = []
const pages: { url?: string; errorCategory?: string }[] = []

function crawlInput(overrides: Partial<CrawlInput> = {}): CrawlInput {
  return {
    runId: `run-${Math.random().toString(36).slice(2)}`,
    organizationId: orgId,
    startUrls: [],
    maxPages: 10,
    maxDepth: 1,
    concurrency: { min: 1, max: 1 },
    onPage: (p) => void pages.push({ url: p.url, errorCategory: p.errorCategory }),
    onEvent: (e) => void events.push(e),
    ...overrides,
  }
}

function startServer(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

afterAll(() => {
  process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "false"
})

describe("crawler: robots.txt", () => {
  it("skips URLs disallowed by robots.txt (SSRF disabled, so the local server is the fetch path)", async () => {
    const server = await startServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.setHeader("content-type", "text/plain")
        res.end("User-agent: *\nDisallow: /private\n")
        return
      }
res.setHeader("content-type", "text/html")
        res.end(`<html><title>${req.url}</title><a href="/private">private</a></html>`)
    })
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
      const input = crawlInput({
        respectRobotsTxt: true,
        maxDepth: 2,
        startUrls: [`http://127.0.0.1:${(server.address() as AddressInfo).port}/`],
      })
      const result = await crawleeWebCrawler.crawl(input)
      expect(result.pagesSucceeded).toBe(1)
      expect(pages.some((p) => p.url?.includes("/private"))).toBe(false)
      expect(events.some((e) => e.category === "ROBOTS_BLOCKED")).toBe(true)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })
})

describe("crawler: SSRF guard", () => {
  it("blocks private targets when ALLOW_PRIVATE_NETWORK_TARGETS=false", async () => {
    const server = await startServer((_req, res) => {
    res.setHeader("content-type", "text/html")
    res.end("<html>hi</html>")
  })
    const port = (server.address() as AddressInfo).port
    const input = crawlInput({ startUrls: [`http://127.0.0.1:${port}/`] })
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "false"
      const guard = createSsrFGuard()
      const check = await guard.checkUrl(`http://127.0.0.1:${port}/`)
      expect(check.ok).toBe(false)

      const result = await crawleeWebCrawler.crawl(input)
      expect(result.pagesSucceeded).toBe(0)
      expect(result.pagesFailed).toBeGreaterThan(0)
      expect(events.some((e) => e.category === "SSRF_BLOCKED")).toBe(true)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })

  it("crawls private targets when ALLOW_PRIVATE_NETWORK_TARGETS=true (test-only escape hatch)", async () => {
    const server = await startServer((_req, res) => {
      res.setHeader("content-type", "text/html")
      res.end(`<html><head><title>local</title></head><body>hello</body></html>`)
    })
    const port = (server.address() as AddressInfo).port
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
      const input = crawlInput({ startUrls: [`http://127.0.0.1:${port}/`] })
      const result = await crawleeWebCrawler.crawl(input)
      expect(result.pagesSucceeded).toBeGreaterThanOrEqual(1)
      expect(result.pagesSkipped).toBe(0)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })
})

describe("crawler: user agent", () => {
  it("sends the configured user agent", async () => {
    const saved: string[] = []
const server = await startServer((req, res) => {
    saved.push(req.headers["user-agent"] ?? "")
    res.setHeader("content-type", "text/html")
    res.end("<html>ok</html>")
  })
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
      const input = crawlInput({
        startUrls: [`http://127.0.0.1:${(server.address() as AddressInfo).port}/`],
        userAgent: "TestEngineBot/9.9",
      })
      await crawleeWebCrawler.crawl(input)
      expect(saved.length).toBeGreaterThan(0)
      expect(saved.every((ua) => ua === "TestEngineBot/9.9")).toBe(true)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })
})

describe("crawler: limits and cancellation", () => {
  it("respects maxPages", async () => {
    const server = await startServer((_req, res) => {
    res.setHeader("content-type", "text/html")
    res.end("<html>ok</html>")
  })
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
      const input = crawlInput({ startUrls: [`http://127.0.0.1:${(server.address() as AddressInfo).port}/`], maxPages: 2 })
      const result = await crawleeWebCrawler.crawl(input)
      expect(result.pagesProcessed).toBeLessThanOrEqual(2)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })

  it("cancels an in-flight run via cancel()", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started = false
const server = await startServer(async (_req, res) => {
    started = true
    await gate
    res.setHeader("content-type", "text/html")
    res.end("<html>ok</html>")
  })
    try {
      process.env.ALLOW_PRIVATE_NETWORK_TARGETS = "true"
      const input = crawlInput({
        runId: "run-cancel-me",
        startUrls: [`http://127.0.0.1:${(server.address() as AddressInfo).port}/`],
        onPage: () => undefined,
      })
      const promise = crawleeWebCrawler.crawl(input)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(started).toBe(true)
      crawleeWebCrawler.cancel("run-cancel-me")
      release()
      const result = await promise
      expect(result.cancelled).toBe(true)
    } finally {
      server.close()
      pages.length = 0
      events.length = 0
    }
  })
})