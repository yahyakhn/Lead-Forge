import { z } from "zod"
import { CRAWL_DEFAULTS, CRAWL_LIMITS } from "@/lib/lead-engine/crawler/defaults"
import { isValidCrawlUrl } from "@/lib/lead-engine/crawler/urls"

// Website source configuration (spec §35). All limits are validated
// server-side against the safety caps from CRAWL_LIMITS (spec §8) — the UI
// can never request maxPages=100000000 or concurrency=1000.

function domainSchema(label: string) {
  return z
    .string()
    .trim()
    .max(253)
    .refine((value) => /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(value) && !value.includes(".."), { message: `${label} must be a valid domain` })
}

const startUrlSchema = z
  .string()
  .trim()
  .max(CRAWL_LIMITS.startUrlLengthMax)
  .refine(isValidCrawlUrl, { message: "Start URLs must be valid http(s) URLs" })

export const websiteConfigSchema = z
  .object({
    startUrls: z.array(startUrlSchema).min(1, "At least one start URL is required").max(CRAWL_LIMITS.startUrlsMax),
    allowedDomains: z.array(domainSchema("Allowed domain")).max(CRAWL_LIMITS.allowedDomainsMax).optional(),
    maxPages: z.number().int().min(1).max(CRAWL_LIMITS.maxPagesMax).default(CRAWL_DEFAULTS.maxPages),
    maxDepth: z.number().int().min(0).max(CRAWL_LIMITS.maxDepthMax).default(CRAWL_DEFAULTS.maxDepth),
    concurrency: z
      .object({
        min: z.number().int().min(1).max(CRAWL_LIMITS.concurrencyMinMax).default(CRAWL_DEFAULTS.concurrencyMin),
        max: z.number().int().min(1).max(CRAWL_LIMITS.concurrencyMinMax).default(CRAWL_DEFAULTS.concurrencyMax),
      })
      .default({ min: CRAWL_DEFAULTS.concurrencyMin, max: CRAWL_DEFAULTS.concurrencyMax }),
    requestTimeoutMs: z.number().int().min(1000).max(CRAWL_LIMITS.requestTimeoutMsMax).default(CRAWL_DEFAULTS.requestTimeoutMs),
    delayMs: z.number().int().min(0).max(120_000).default(0),
    respectRobotsTxt: z.boolean().default(CRAWL_DEFAULTS.respectRobotsTxt),
  })
  .strict()

export type WebsiteConfig = z.infer<typeof websiteConfigSchema>

export function buildWebsiteConfig(raw: unknown): WebsiteConfig {
  const parsed = websiteConfigSchema.parse(raw)
  if (parsed.concurrency.min > parsed.concurrency.max) {
    throw new Error("Concurrency min cannot exceed concurrency max")
  }
  return parsed
}