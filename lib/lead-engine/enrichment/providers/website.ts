// TASK 013 §5-§6: first-party website enrichment. Reuses TASK 007's crawler
// (robots.txt, SSRF guard, rate limiting, timeouts) and TASK 008's
// deterministic extractor — no second crawler, no AI, no fabricated data.

import { crawleeWebCrawler } from "@/lib/lead-engine/crawler/crawlee"
import type { CrawledPage } from "@/lib/lead-engine/crawler/types"
import { ErrorCategory } from "@/lib/lead-engine/error-categories"
import { classifyPage } from "@/lib/lead-engine/extraction/classify"
import { extractDeterministic } from "@/lib/lead-engine/extraction/deterministic"
import type { DeterministicResult, EvidenceType } from "@/lib/lead-engine/extraction/types"
import { normalizeEmail, normalizePhone, normalizeUrl } from "@/lib/lead-engine/extraction/normalize"
import { normalizeDomain } from "@/lib/lead-engine/resolution/normalize"
import { sourceQuality } from "@/lib/lead-engine/resolution/quality"
import type { EnrichmentField, EnrichmentInput, EnrichmentOutcome, EnrichmentProvider } from "@/lib/lead-engine/enrichment/providers/types"
import type { EnrichmentFieldName } from "@/lib/lead-engine/enrichment/fields"

// Description priority (§23): About → Company page → Homepage → Product.
const DESCRIPTION_PAGE_ORDER = ["ABOUT", "COMPANY_HOME", "PRODUCT", "CONTACT", "OTHER"]

const EVIDENCE_CONFIDENCE: Record<EvidenceType, number> = {
  JSON_LD: 0.85,
  META: 0.8,
  VISIBLE_TEXT: 0.7,
  MAILTO: 0.9,
  LINK: 0.85,
  URL: 0.95,
  AI: 0.5,
}

// Conservative deterministic industry hints (§24) — explicit keywords only.
const INDUSTRY_HINTS: Array<[string, RegExp]> = [
  ["SaaS", /\b(saas|software|platform|cloud software|app development|api platform)\b/i],
  ["Ecommerce", /\b(ecommerce|e-commerce|online store|ecommerce platform|retail)\b/i],
  ["Fintech", /\b(fintech|financial services|payments?|banking|insurance|wealth)\b/i],
  ["Healthcare", /\b(healthcare|health care|medical|clinic|hospital|pharma(ceutical)?s?)\b/i],
  ["Manufacturing", /\b(manufacturing|factory|industrial|hardware)\b/i],
  ["Logistics", /\b(logistics|shipping|supply chain|freight|delivery)\b/i],
  ["Marketing", /\b(marketing agency|advertising|branding|seo|growth agency)\b/i],
  ["EdTech", /\b(edtech|education|e-learning|online learning|training platform)\b/i],
  ["HR Tech", /\b(hr tech|recruiting|hiring platform|talent|workforce|payroll)\b/i],
  ["Food & Beverage", /\b(restaurant|catering|coffee|food delivery|beverage)\b/i],
  ["Real Estate", /\b(real estate|property management|construction)\b/i],
  ["Travel", /\b(travel|tourism|hotel|booking platform)\b/i],
]

// Broad technology signals (§22) — no fingerprinting database.
const TECH_MARKERS: Array<[string, RegExp]> = [
  ["WordPress", /wp-content|wp-includes|wordpress/i],
  ["Shopify", /shopify|cdn\.shopify/i],
  ["Webflow", /webflow/i],
  ["Next.js", /__NEXT_DATA__|\/_next\//i],
  ["React", /data-reactroot|react-dom/i],
  ["Vue", /data-v-|vue\.js/i],
  ["Angular", /ng-version/i],
  ["Django", /django/i],
  ["Wix", /wix\.com|wix-static/i],
  ["Squarespace", /squarespace/i],
]

const GENERIC_EMAIL_DOMAINS = /@(gmail|yahoo|hotmail|outlook|icloud|proton|live|aol|yandex|qq|163|sina)\./i

const round2 = (n: number) => Math.round(n * 100) / 100

function pageConfidence(evidence: EvidenceType, category: string | null): number {
  return round2(EVIDENCE_CONFIDENCE[evidence] * (0.4 + 0.6 * sourceQuality(category)))
}

function toStartUrl(raw: string): string | null {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return normalizeUrl(withProtocol) || null
}

interface PageExtract {
  page: CrawledPage
  category: string | null
  result: DeterministicResult
}

export const websiteEnrichmentProvider: EnrichmentProvider = {
  id: "WEBSITE",
  name: "Company website",
  capabilities: ["COMPANY", "CONTACT", "TECHNOLOGY", "EVIDENCE"],

  async enrich(input: EnrichmentInput): Promise<EnrichmentOutcome> {
    const domain = normalizeDomain(input.target.companyDomain ?? input.target.websiteUrl ?? "")
    const start = toStartUrl(input.target.websiteUrl ?? (domain ? `https://${domain}` : ""))
    if (!domain || !start) {
      return { fields: [], pagesVisited: 0, errorCode: ErrorCategory.INVALID_URL, errorMessage: "No usable website or domain" }
    }

    const pages: CrawledPage[] = []
    const errors: string[] = []
    await crawleeWebCrawler.crawl({
      runId: `enrich:${input.requestId}`,
      organizationId: input.target.id,
      startUrls: [start],
      maxPages: input.maxPages,
      maxDepth: input.maxDepth,
      requestTimeoutMs: input.requestTimeoutMs,
      rateLimit: { delayMs: input.requestDelayMs },
      allowedDomains: [domain, ...input.allowedDomains],
      respectRobotsTxt: true,
      onPage: (page) => {
        pages.push(page)
      },
      onEvent: (event) => {
        if (event.level === "ERROR") errors.push(event.category ?? "UNKNOWN")
      },
    })

    const extracts: PageExtract[] = []
    for (const page of pages) {
      if (page.errorCategory) continue
      const classification = classifyPage({
        url: page.url,
        title: page.title ?? "",
        headings: (page.metadata?.headings as string[] | undefined) ?? [],
        linkTexts: [],
      })
      if (classification.skip || classification.category === "OTHER") continue
      extracts.push({ page, category: classification.category, result: extractDeterministic({ url: page.url, title: page.title, html: page.html, textContent: page.textContent, metadata: page.metadata }) })
    }
    const fetched = pages.filter((p) => !p.errorCategory)

    const fields: EnrichmentField[] = []
    const add = (field: EnrichmentFieldName, value: string, opts: { sourceUrl?: string; method?: string; confidence: number; normalizedValue?: string; evidence?: string }) => {
      if (!value) return
      const existing = fields.find((f) => f.field === field && sameRaw(f.value, value))
      if (existing) {
        if (opts.confidence > existing.confidence) {
          existing.confidence = opts.confidence
          existing.sourceUrl = opts.sourceUrl ?? existing.sourceUrl
          existing.evidence = opts.evidence ?? existing.evidence
        }
        return
      }
      fields.push({
        field,
        value,
        normalizedValue: opts.normalizedValue,
        source: "PUBLIC_WEBSITE",
        sourceUrl: opts.sourceUrl,
        evidence: opts.evidence,
        method: opts.method ?? "PUBLIC_WEBSITE",
        confidence: opts.confidence,
      })
    }
    const sameRaw = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

    if (pages.length === 0) {
      const category = errors[0] ?? "PROVIDER_ERROR"
      return { fields: [], pagesVisited: 0, errorCode: category, errorMessage: `No pages fetched (${category})` }
    }
    const companyName = firstOf(extracts, (e) => e.result.company.name, "company_name")
    if (companyName) add("company_name", companyName.value, { confidence: companyName.confidence, sourceUrl: companyName.sourceUrl, method: "PUBLIC_WEBSITE" })

    add("company_domain", domain, { confidence: 0.99, sourceUrl: start, method: "PUBLIC_WEBSITE" })
    add("website", start, { confidence: 0.99, sourceUrl: start, method: "PUBLIC_WEBSITE" })

    const description = bestDescription(extracts)
    if (description) {
      add("description", description.value, { confidence: description.confidence, sourceUrl: description.sourceUrl, evidence: description.evidence, method: "PUBLIC_WEBSITE" })
    }

    const industry = inferIndustry(extracts)
    if (industry) {
      add("industry", industry.value, { confidence: 0.5, sourceUrl: industry.sourceUrl, evidence: industry.evidence, method: "PUBLIC_WEBSITE" })
    }

    const location = firstAddress(extracts)
    if (location) {
      const { sourceUrl, confidence } = location
      if (location.country) add("country", location.country, { confidence, sourceUrl, method: "PUBLIC_WEBSITE" })
      if (location.region) add("region", location.region, { confidence, sourceUrl, method: "PUBLIC_WEBSITE" })
      if (location.city) add("city", location.city, { confidence, sourceUrl, method: "PUBLIC_WEBSITE" })
    }

    const phone = firstPhone(extracts)
    if (phone) {
      const normalized = normalizePhone(phone.value) ?? undefined
      add("phone", phone.value, { confidence: phone.confidence, sourceUrl: phone.sourceUrl, method: "PUBLIC_WEBSITE", normalizedValue: normalized })
    }

    const email = bestEmail(extracts, domain)
    if (email) {
      add("email", email.value, { confidence: email.confidence, sourceUrl: email.sourceUrl, method: "PUBLIC_WEBSITE", normalizedValue: email.value })
    }

    const linkedin = bestLinkedIn(extracts)
    if (linkedin) {
      add("linkedin_url", linkedin.value, { confidence: linkedin.confidence, sourceUrl: linkedin.sourceUrl, method: "PUBLIC_WEBSITE" })
    }

    const social = firstSocial(extracts)
    if (social) add("social_links", social, { confidence: 0.8, sourceUrl: social, method: "PUBLIC_WEBSITE" })

    const keywords = metaKeywords(extracts)
    if (keywords) add("keywords", keywords, { confidence: 0.7, method: "PUBLIC_WEBSITE" })

    for (const [tech, marker] of TECH_MARKERS) {
      if (extracts.some((e) => e.page.html?.match(marker))) {
        add("technology", tech, { confidence: 0.6, method: "PUBLIC_WEBSITE" })
      }
    }

    const contact = firstContact(extracts)
    if (contact) {
      if (contact.fullName) add("contact_name", contact.fullName, { confidence: contact.confidence, sourceUrl: contact.sourceUrl, method: "PUBLIC_WEBSITE" })
      if (contact.jobTitle) add("job_title", contact.jobTitle, { confidence: contact.confidence, sourceUrl: contact.sourceUrl, method: "PUBLIC_WEBSITE" })
    }

    if (fetched.length === 0) {
      const category = errors[0] ?? "PROVIDER_ERROR"
      return { fields: [], pagesVisited: 0, errorCode: category, errorMessage: `No pages fetched (${category})` }
    }
    if (fields.length === 0) {
      return { fields: [], pagesVisited: fetched.length, errorCode: "INSUFFICIENT_DATA", errorMessage: "Pages fetched but no enrichment fields extracted" }
    }
    return { fields, pagesVisited: fetched.length }
  },
}

// ── field aggregation helpers ─────────────────────────────────────────────

interface Picked {
  value: string
  sourceUrl?: string
  confidence: number
  evidence?: string
}

function firstOf(extracts: PageExtract[], pick: (e: PageExtract) => string | undefined, evidenceFor: EnrichmentFieldName): Picked | null {
  for (const e of extracts) {
    const value = pick(e)
    if (!value) continue
    const evidence = e.result.evidence.find((ev) => ev.field === evidenceFor && ev.value === value)
    return {
      value,
      sourceUrl: evidence?.sourceUrl ?? e.page.url,
      confidence: pageConfidence((evidence?.evidenceType as EvidenceType) ?? "VISIBLE_TEXT", e.category),
      evidence: evidence?.value,
    }
  }
  return null
}

function bestDescription(extracts: PageExtract[]): Picked | null {
  for (const category of DESCRIPTION_PAGE_ORDER) {
    for (const e of extracts) {
      if (e.category !== category) continue
      const value = e.result.company.description
      if (value) {
        const evidence = e.result.evidence.find((ev) => ev.field === "description" && ev.value === value)
        return {
          value,
          sourceUrl: evidence?.sourceUrl ?? e.page.url,
          confidence: pageConfidence((evidence?.evidenceType as EvidenceType) ?? "META", e.category),
          evidence: evidence?.value.slice(0, 300),
        }
      }
    }
  }
  return null
}

function inferIndustry(extracts: PageExtract[]): Picked | null {
  for (const [industry, pattern] of INDUSTRY_HINTS) {
    for (const e of extracts) {
      const text = `${e.page.textContent ?? ""} ${e.page.title ?? ""}`
      const match = text.match(pattern)
      if (match) {
        return {
          value: industry,
          sourceUrl: e.page.url,
          confidence: 0.5,
          evidence: match[0].slice(0, 200),
        }
      }
    }
  }
  return null
}

function firstAddress(extracts: PageExtract[]): { country?: string; region?: string; city?: string; sourceUrl: string; confidence: number } | null {
  for (const e of extracts) {
    const addr = e.result.company
    if (addr.country || addr.region || addr.city) {
      const confidence = pageConfidence("JSON_LD", e.category)
      return { ...(addr.country ? { country: addr.country } : {}), ...(addr.region ? { region: addr.region } : {}), ...(addr.city ? { city: addr.city } : {}), sourceUrl: e.page.url, confidence }
    }
  }
  return null
}

function firstPhone(extracts: PageExtract[]): Picked | null {
  const prefersTel = [...extracts].sort((a, b) => sourceQuality(a.category) - sourceQuality(b.category))
  for (const e of prefersTel) {
    const phone = e.result.phones[0]
    if (!phone) continue
    const raw = phone.raw.trim()
    const normalized = normalizePhone(raw)
    if (!normalized) continue
    if (raw.length > 40) continue
    return {
      value: raw,
      sourceUrl: e.page.url,
      confidence: pageConfidence("LINK", e.category),
      evidence: raw.slice(0, 100),
    }
  }
  return null
}

function bestEmail(extracts: PageExtract[], domain: string): Picked | null {
  const ranked = [...extracts].sort((a, b) => sourceQuality(b.category) - sourceQuality(a.category))
  const seen = new Set<string>()
  for (const e of ranked) {
    for (const email of e.result.emails) {
      const normalized = normalizeEmail(email)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      if (domain && normalized.endsWith(`@${domain}`)) {
        return { value: normalized, sourceUrl: e.page.url, confidence: pageConfidence("MAILTO", e.category), evidence: normalized }
      }
    }
  }
  for (const e of ranked) {
    for (const email of e.result.emails) {
      const normalized = normalizeEmail(email)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      if (!GENERIC_EMAIL_DOMAINS.test(normalized)) {
        return { value: normalized, sourceUrl: e.page.url, confidence: pageConfidence("MAILTO", e.category), evidence: normalized }
      }
    }
  }
  for (const e of ranked) {
    for (const email of e.result.emails) {
      const normalized = normalizeEmail(email)
      if (normalized && !seen.has(normalized)) {
        return { value: normalized, sourceUrl: e.page.url, confidence: pageConfidence("MAILTO", e.category), evidence: normalized }
      }
    }
  }
  return null
}

function bestLinkedIn(extracts: PageExtract[]): Picked | null {
  for (const e of extracts) {
    const company = e.result.linkedinUrls.find((u) => /linkedin\.com\/company\//.test(u))
    if (company) return { value: company, sourceUrl: e.page.url, confidence: pageConfidence("LINK", e.category), evidence: company }
  }
  for (const e of extracts) {
    const personal = e.result.linkedinUrls.find((u) => /linkedin\.com\/in\//.test(u))
    if (personal) return { value: personal, sourceUrl: e.page.url, confidence: pageConfidence("LINK", e.category), evidence: personal }
  }
  return null
}

function firstSocial(extracts: PageExtract[]): string | null {
  const socialHosts = /(x\.com|twitter\.com|facebook\.com|instagram\.com|youtube\.com|youtu\.be)/
  for (const e of extracts) {
    const social = e.result.socialLinks.find((u) => socialHosts.test(u))
    if (social) return social
  }
  return null
}

function metaKeywords(extracts: PageExtract[]): string | null {
  for (const e of extracts) {
    const html = e.page.html ?? ""
    const match = html.match(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']{5,400})["']/i)
    if (match) {
      return match[1]
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 12)
        .join("; ")
    }
  }
  return null
}

function firstContact(extracts: PageExtract[]): Picked & { fullName?: string; jobTitle?: string } | null {
  const ranked = [...extracts].sort((a, b) => sourceQuality(b.category) - sourceQuality(a.category))
  for (const e of ranked) {
    const contact = e.result.contacts.find((c) => c.fullName || c.jobTitle)
    if (!contact) continue
    return {
      fullName: contact.fullName,
      jobTitle: contact.jobTitle,
      sourceUrl: e.page.url,
      confidence: pageConfidence("LINK", e.category),
      value: contact.fullName ?? contact.jobTitle ?? "",
    }
  }
  return null
}
