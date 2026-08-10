import { demoConfigSchema } from "@/lib/lead-engine/config-schemas"
import type { ConfigValidation, DiscoveryInput, DiscoveryTarget, LeadSourceAdapter, ScrapeInput, ScrapeResult } from "@/lib/lead-engine/types"
import { LeadSourceType, SourceCapability } from "@/generated/prisma/enums"

const COMPANIES = [
  { name: "Northwind Software", domain: "northwind.io", industry: "SaaS" },
  { name: "Acme Data Systems", domain: "acme-data.com", industry: "Data & Analytics" },
  { name: "Bluefin Robotics", domain: "bluefin-robotics.com", industry: "Hardware" },
  { name: "Cedar Health", domain: "cedarhealth.com", industry: "HealthTech" },
  { name: "Delta Payments", domain: "deltapayments.io", industry: "Fintech" },
  { name: "Ember Analytics", domain: "emberanalytics.com", industry: "Data & Analytics" },
  { name: "Ferrum Logistics", domain: "ferrumlogistics.com", industry: "Logistics" },
  { name: "Grove EdTech", domain: "groveedtech.com", industry: "EdTech" },
  { name: "Harbor Security", domain: "harborsecurity.io", industry: "Security" },
  { name: "Iris Retail", domain: "irisretail.com", industry: "E-commerce" },
  { name: "Juniper Travel", domain: "junipertravel.io", industry: "Travel" },
  { name: "Kestrel AI", domain: "kestrelai.com", industry: "AI" },
] as const

const NAMES = [
  ["Jane", "Doe"],
  ["John", "Smith"],
  ["Priya", "Sharma"],
  ["Luis", "Garcia"],
  ["Fatima", "Ali"],
  ["Kenji", "Tanaka"],
] as const

const TITLES = ["VP Sales", "Head of Marketing", "Founder & CEO", "Director of Partnerships", "Head of Growth", "CTO"] as const

function countFor(config: unknown): number {
  const parsed = demoConfigSchema.safeParse(config)
  const maxResults = parsed.success ? (parsed.data.maxResults ?? COMPANIES.length) : COMPANIES.length
  return Math.min(maxResults, COMPANIES.length)
}

export const demoAdapter: LeadSourceAdapter = {
  id: "demo",
  name: "Demo Source",
  description: "Deterministic development source. Returns fixed sample records and never makes external requests.",
  type: LeadSourceType.CUSTOM,
  capabilities: [SourceCapability.DISCOVERY, SourceCapability.SCRAPING, SourceCapability.COMPANY_EXTRACTION, SourceCapability.CONTACT_EXTRACTION],

  validateConfig(config: unknown): ConfigValidation {
    const parsed = demoConfigSchema.safeParse(config)
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid configuration" }
    return { ok: true }
  },

  async discover(input: DiscoveryInput): Promise<DiscoveryTarget[]> {
    const count = Math.min(input.maxResults ?? COMPANIES.length, COMPANIES.length)
    return COMPANIES.slice(0, count).map((company) => ({ type: "DOMAIN", value: company.domain, title: company.name }))
  },

  async scrape(input: ScrapeInput): Promise<ScrapeResult> {
    const count = countFor(input.config)
    const records = COMPANIES.slice(0, count).map((company, i) => {
      const [firstName, lastName] = NAMES[i % NAMES.length]
      const title = TITLES[i % TITLES.length]
      return {
        externalId: company.domain,
        sourceUrl: `https://${company.domain}/team`,
        data: {
          company: { name: company.name, domain: company.domain, industry: company.industry },
          contact: { firstName, lastName, title, email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${company.domain}` },
          sourceType: "demo",
        },
      }
    })
    return { records, stats: { discovered: records.length, processed: records.length, failed: 0 } }
  },
}