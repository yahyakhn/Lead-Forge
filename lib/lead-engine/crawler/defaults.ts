// Centralized, conservative crawl defaults (spec §7) and hard server-side
// safety limits (spec §8). Never trust client-provided values beyond these caps.

export const CRAWL_DEFAULTS = {
  maxPages: 100,
  maxDepth: 2,
  concurrencyMin: 1,
  concurrencyMax: 3,
  requestTimeoutMs: 15_000,
  respectRobotsTxt: true,
  maxRedirects: 5,
  maxRetries: 2,
  // Test runs (spec §48) override the configured limits.
  testMaxPages: 3,
  testMaxDepth: 1,
} as const

export const CRAWL_LIMITS = {
  maxPagesMax: 1000,
  maxDepthMax: 5,
  concurrencyMinMax: 10,
  requestTimeoutMsMax: 60_000,
  startUrlsMax: 20,
  allowedDomainsMax: 20,
  startUrlLengthMax: 2048,
} as const

// Response body constraints (spec §24, §27, §53). HTML is truncated at the
// cap and the truncation is recorded; the text view is capped separately.
export const HTML_MAX_BYTES = 5 * 1024 * 1024
export const TEXT_MAX_BYTES = 256 * 1024
export const METADATA_MAX_LINKS = 200
export const METADATA_MAX_HEADINGS = 25
export const METADATA_MAX_HEADING_LENGTH = 300

export function isPrivateNetworkAllowed(): boolean {
  // Development/test escape hatch so crawl tests can target a local HTTP
  // server (spec §57). Production must never set this to true.
  return process.env.ALLOW_PRIVATE_NETWORK_TARGETS === "true"
}

export function defaultUserAgent(): string {
  return process.env.LEAD_ENGINE_USER_AGENT?.trim() || "StartupLeadEngineBot/1.0"
}