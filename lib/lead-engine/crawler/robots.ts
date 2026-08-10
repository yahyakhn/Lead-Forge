import { RobotsTxtFile } from "crawlee"
import { isPrivateNetworkAllowed } from "@/lib/lead-engine/crawler/defaults"
import type { SsrFGuard } from "@/lib/lead-engine/crawler/urls"

// robots.txt handling (spec §12). Crawlee's own robots machinery is not used
// so that robots.txt fetches are SSRF-guarded like every other request: the
// target URL is validated before the robots file is fetched, and results are
// cached per origin for the duration of a crawl.

const ROBOTS_TIMEOUT_MS = 10_000

export function createRobotsChecker(guard: SsrFGuard, userAgent: string) {
  const cache = new Map<string, RobotsTxtFile | null>()

  async function forUrl(url: string): Promise<RobotsTxtFile | null> {
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      return null
    }
    const cached = cache.get(origin)
    if (cached !== undefined) return cached

    const safe = isPrivateNetworkAllowed() || (await guard.checkUrl(url)).ok
    if (!safe) {
      cache.set(origin, null)
      return null
    }
    let file: RobotsTxtFile | null = null
    try {
      const robotsUrl = new URL(url)
      robotsUrl.pathname = "/robots.txt"
      robotsUrl.search = ""
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS)
      try {
        const response = await fetch(robotsUrl, {
          headers: { "user-agent": userAgent },
          redirect: "follow",
          signal: controller.signal,
        })
        if (response.ok) {
          file = RobotsTxtFile.from(robotsUrl.toString(), await response.text())
        }
      } finally {
        clearTimeout(timer)
      }
    } catch {
      file = null
    }
    cache.set(origin, file)
    return file
  }

  // Missing robots.txt / fetch errors are treated as "allowed", never as an
  // excuse to stop crawling (spec §12: skipped only when actually disallowed).
  return async function robotsAllow(url: string): Promise<boolean> {
    const file = await forUrl(url)
    if (!file) return true
    return file.isAllowed(url, userAgent)
  }
}