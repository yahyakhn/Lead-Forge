import * as cheerio from "cheerio"
import type { DeterministicContact, DeterministicResult, EvidenceType, JobPosting } from "@/lib/lead-engine/extraction/types"
import { EMAIL_PATTERN, PHONE_PATTERNS, isPlausibleName, normalizeDomain, normalizeEmail, normalizePhone, normalizeText, normalizeUrl } from "@/lib/lead-engine/extraction/normalize"

// Deterministic extraction (spec §13-§23): metadata, JSON-LD, mailto/tel
// links, visible text, social links. No AI, no aggressive text mining.

const JSON_LD_ORG_TYPES = new Set(["Organization", "Corporation", "LocalBusiness", "NGO", "EducationalOrganization", "GovernmentOrganization", "MedicalOrganization", "SoftwareApplication"])
const JSON_LD_PAGE_TYPES = new Set(["AboutPage", "ContactPage", "WebPage"])
const ALL_JSON_LD_TYPES = new Set([...JSON_LD_ORG_TYPES, "Person", "JobPosting", "WebSite", "ContactPoint", ...JSON_LD_PAGE_TYPES])

const SOCIAL_HOSTS: Record<string, string> = {
  "linkedin.com": "linkedin",
  "x.com": "twitter",
  "twitter.com": "twitter",
  "facebook.com": "facebook",
  "instagram.com": "instagram",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
}

const TITLE_PATTERN =
  /(?:Co-?Founder|Founder|CEO|CTO|CFO|COO|CMO|CIO|President|Vice President|VP|Head of|Director of?|Director|Partner|Manager|Lead|Sales|Marketing|Growth|Partnerships|Engineering|Operations|Designer|Recruiter|Sales Development|Account Executive)/i

export interface DeterministicInput {
  url: string
  title?: string | null
  html?: string | null
  textContent?: string | null
  metadata: Record<string, unknown> | null
}

interface JsonLdNode {
  type: string
  raw: Record<string, unknown>
}

function normalizeLink(url: string): string {
  return normalizeUrl(url).replace(/^http:\/\//, "https://").replace(/^https:\/\/www\./, "https://")
}

function collectJsonLd(html: string): JsonLdNode[] {
  const nodes: JsonLdNode[] = []
  const $ = cheerio.load(html)
  $('script[type="application/ld+json"]').each((_, el) => {
    const text = $(el).text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (typeof value !== "object" || value === null) return
      const raw = value as Record<string, unknown>
      if (typeof raw["@type"] === "string") {
        const type = raw["@type"].split("/").pop() ?? ""
        if (ALL_JSON_LD_TYPES.has(type)) nodes.push({ type, raw })
      }
      for (const v of Object.values(raw)) {
        if (Array.isArray(v) || (typeof v === "object" && v !== null)) visit(v)
      }
    }
    visit(parsed)
  })
  return nodes
}

const toText = (value: unknown): string | undefined => {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return undefined
}

function fromAddress(address: unknown): { country?: string; region?: string; city?: string } {
  if (!address || typeof address !== "object") return {}
  const raw = address as Record<string, unknown>
  const countryField = raw.addressCountry
  const country = typeof countryField === "object" && countryField ? toText((countryField as Record<string, unknown>).name) : toText(countryField)
  return {
    country,
    region: toText(raw.addressRegion),
    city: toText(raw.addressLocality),
  }
}

function firstEmail(value: unknown): string | null {
  const text = toText(value)
  if (!text) return null
  const match = text.match(EMAIL_PATTERN)
  return match ? normalizeEmail(match[0]) : null
}

function linkedinFrom(value: unknown): string | null {
  const text = toText(value)
  if (!text) return null
  const match = text.match(/linkedin\.com\/(?:company|in|school)\/[a-zA-Z0-9._%-]+/i)
  if (!match) return null
  return normalizeLink(`https://${match[0]}`)
}

export function extractDeterministic(input: DeterministicInput): DeterministicResult {
  const url = input.url
  const meta = input.metadata ?? {}
  const html = input.html ?? ""
  const result: DeterministicResult = {
    company: {},
    contacts: [],
    emails: [],
    phones: [],
    linkedinUrls: [],
    socialLinks: [],
    jobs: [],
    evidence: [],
  }

  const note = (field: string, value: string, evidenceType: EvidenceType, sourceUrl?: string) => {
    if (!value) return
    result.evidence.push({ field, value, sourceUrl: sourceUrl ?? url, evidenceType })
  }

  const $ = html ? cheerio.load(html) : null

  // --- 1. JSON-LD (spec §14-§17) ---
  const ld = html ? collectJsonLd(html) : []

  for (const node of ld) {
    if (JSON_LD_ORG_TYPES.has(node.type)) {
      if (!result.company.name && toText(node.raw.name)) {
        result.company.name = normalizeText(toText(node.raw.name)!)
        note("company_name", result.company.name, "JSON_LD")
      }
      if (!result.company.website && toText(node.raw.url)) {
        result.company.website = normalizeUrl(toText(node.raw.url)!)
        note("company_website", result.company.website, "JSON_LD")
      }
      if (!result.company.description && toText(node.raw.description)) {
        result.company.description = normalizeText(toText(node.raw.description)!).slice(0, 2000)
        note("description", result.company.description, "JSON_LD")
      }
      if (!result.company.logo && toText(node.raw.logo)) {
        result.company.logo = toText(node.raw.logo)
      }
      const addr = fromAddress(node.raw.address)
      if (!result.company.country && addr.country) {
        result.company.country = addr.country
        note("country", addr.country, "JSON_LD")
      }
      if (!result.company.region && addr.region) {
        result.company.region = addr.region
        note("region", addr.region, "JSON_LD")
      }
      if (!result.company.city && addr.city) {
        result.company.city = addr.city
        note("city", addr.city, "JSON_LD")
      }
      const cp = Array.isArray(node.raw.contactPoint) ? node.raw.contactPoint : node.raw.contactPoint ? [node.raw.contactPoint] : []
      for (const point of cp as Record<string, unknown>[]) {
        const email = firstEmail(point.email)
        if (email && !result.emails.includes(email)) {
          result.emails.push(email)
          note("email", email, "JSON_LD")
        }
        const phone = toText(point.telephone)
        if (phone) {
          result.phones.push({ raw: phone })
          note("phone", phone, "JSON_LD")
        }
      }
      const sameAs = Array.isArray(node.raw.sameAs) ? (node.raw.sameAs as unknown[]).map(toText).filter(Boolean) : []
      for (const linkValue of sameAs) {
        const linkedin = linkedinFrom(linkValue)
        if (linkedin && !result.linkedinUrls.includes(linkedin)) {
          result.linkedinUrls.push(linkedin)
          note("linkedin_url", linkedin, "JSON_LD")
        } else if (linkValue) {
          result.socialLinks.push(normalizeLink(linkValue))
        }
      }
    }

    if (node.type === "Person") {
      const nameRaw = toText(node.raw.name) ?? [toText(node.raw.givenName), toText(node.raw.familyName)].filter(Boolean).join(" ")
      const name = nameRaw ? normalizeText(nameRaw) : undefined
      const contact: DeterministicContact = {
        fullName: name,
        jobTitle: toText(node.raw.jobTitle) ? normalizeText(toText(node.raw.jobTitle)!) : undefined,
        email: firstEmail(node.raw.email) ?? undefined,
        phone: toText(node.raw.telephone) ?? undefined,
        linkedinUrl: linkedinFrom(node.raw.sameAs) ?? undefined,
        evidence: ["JSON_LD"],
      }
      if (name || contact.email || contact.linkedinUrl) {
        result.contacts.push(contact)
        if (name) note("contact_name", name, "JSON_LD")
      }
      if (contact.email && !result.emails.includes(contact.email!)) {
        result.emails.push(contact.email!)
        note("email", contact.email!, "JSON_LD")
      }
      if (!result.company.name) {
        const worksFor = node.raw.worksFor as Record<string, unknown> | undefined
        const orgName = worksFor && typeof worksFor === "object" ? toText(worksFor.name) : undefined
        if (orgName) {
          result.company.name = normalizeText(orgName)
          note("company_name", result.company.name, "JSON_LD")
        }
      }
    }

    if (node.type === "JobPosting") {
      const job: JobPosting = {
        title: toText(node.raw.title) ? normalizeText(toText(node.raw.title)!) : undefined,
        hiringOrganization:
          node.raw.hiringOrganization && typeof node.raw.hiringOrganization === "object"
            ? toText((node.raw.hiringOrganization as Record<string, unknown>).name)
            : undefined,
        location: node.raw.jobLocation && typeof node.raw.jobLocation === "object" ? toText((node.raw.jobLocation as Record<string, unknown>).name) : undefined,
        datePosted: toText(node.raw.datePosted),
        employmentType: toText(node.raw.employmentType),
        description: toText(node.raw.description) ? normalizeText(toText(node.raw.description)!).slice(0, 500) : undefined,
      }
      result.jobs.push(job)
    }
  }

  // --- 2. Metadata signals (spec §13) ---
  if (html && $) {
    const metaContent = (selector: string): string | undefined => $(selector).first().attr("content")?.trim() || undefined

    const siteName = metaContent('meta[property="og:site_name"], meta[name="application-name"]')
    if (!result.company.name && siteName) {
      result.company.name = normalizeText(siteName)
      note("company_name", result.company.name, "META")
    }

    const ogTitle = metaContent('meta[property="og:title"]')
    if (!result.company.name && ogTitle) {
      const withSite = ogTitle.split(/[|\-–—·•]/)[0]?.trim()
      if (withSite) {
        result.company.name = normalizeText(withSite)
        note("company_name", result.company.name, "META")
      }
    }

    const ogDescription = metaContent('meta[property="og:description"]') ?? metaContent('meta[name="description"]')
    if (!result.company.description && ogDescription) {
      result.company.description = normalizeText(ogDescription).slice(0, 2000)
      note("description", result.company.description, "META")
    }

    const author = metaContent('meta[name="author"]')
    if (author && isPlausibleName(author) && !result.contacts.some((c) => c.fullName === normalizeText(author))) {
      result.contacts.push({ fullName: normalizeText(author), evidence: ["META"] })
      note("contact_name", normalizeText(author), "META")
    }
  }

  // --- 3. Company domain (spec §24) ---
  const canonicalUrl = typeof meta.canonicalUrl === "string" ? meta.canonicalUrl : undefined
  const domainSource = canonicalUrl ?? result.company.website ?? url
  const domain = normalizeDomain(domainSource)
  if (domain) {
    result.company.domain = domain
    note("company_domain", domain, "URL")
  }

  // --- 4. Visible text: emails + phones (spec §18-§19) ---
  const textContent = input.textContent ?? ($ ? $("body").text() : "")
  for (const match of textContent.match(EMAIL_PATTERN) ?? []) {
    const email = normalizeEmail(match)
    if (email && !result.emails.includes(email)) {
      result.emails.push(email)
      note("email", email, "VISIBLE_TEXT")
    }
  }
  for (const pattern of PHONE_PATTERNS) {
    for (const match of textContent.match(pattern) ?? []) {
      const normalized = normalizePhone(match)
      const raw = match.trim()
      if (normalized && !result.phones.some((p) => p.normalized === normalized || p.raw === raw)) {
        result.phones.push({ raw, normalized })
        note("phone", raw, "VISIBLE_TEXT")
      }
    }
  }

  // --- 5. Anchor signals: mailto, tel, LinkedIn, social (spec §18-§21) ---
  if (html && $) {
    const anchorHits: { href: string; containerText: string; selfText: string }[] = []
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? ""
      const plain = href.trim().toLowerCase()
      const container = $(el).closest("div,li,section,tr").first().text()
      anchorHits.push({ href, containerText: normalizeText(container), selfText: normalizeText($(el).text()) })
      if (plain.startsWith("mailto:")) {
        const email = normalizeEmail(decodeURIComponent(plain.slice(7)))
        if (email && !result.emails.includes(email)) {
          result.emails.push(email)
          note("email", email, "MAILTO")
        }
        return
      }
      if (plain.startsWith("tel:")) {
        const phone = decodeURIComponent(plain.slice(4)).trim()
        if (phone) {
          result.phones.push({ raw: phone, normalized: normalizePhone(phone) ?? undefined })
          note("phone", phone, "LINK")
        }
        return
      }
      const absolute = fixUrl(href, url)
      if (!absolute) return
      const lower = absolute.toLowerCase()
      if (/linkedin\.com\/(?:company|in|school)\//.test(lower)) {
        const linkedin = normalizeLink(absolute)
        if (!result.linkedinUrls.includes(linkedin)) {
          result.linkedinUrls.push(linkedin)
          note("linkedin_url", linkedin, "LINK")
        }
        return
      }
      let host: string | undefined
      try {
        host = new URL(absolute).hostname.replace(/^www\./, "")
      } catch {
        return
      }
      const socialType = SOCIAL_HOSTS[host]
      if (socialType && !result.socialLinks.includes(normalizeLink(absolute))) {
        result.socialLinks.push(normalizeLink(absolute))
        note("social_link", normalizeLink(absolute), "LINK")
      }
    })

    // --- 6. Team cards: person names near mailto/LinkedIn anchors (spec §22) ---
    for (const hit of anchorHits) {
      const isPersonSignal = /^mailto:/.test(hit.href.toLowerCase()) || /linkedin\.com\/in\//.test(hit.href.toLowerCase())
      if (!isPersonSignal) continue
      const container = hit.containerText
      const nameMatch = container.match(/^([A-ZÀ-ÿ][^.!?]{1,40}?)(?:\s*[–—,|]\s*)/)
      const nameCandidate = (nameMatch?.[1] ?? "").trim() || hit.selfText
      if (!isPlausibleName(nameCandidate)) continue
      const existing = result.contacts.some((c) => c.fullName === nameCandidate)
      if (existing) continue
      const email =
        /^mailto:/.test(hit.href.toLowerCase())
          ? normalizeEmail(decodeURIComponent(hit.href.slice(7))) ?? undefined
          : undefined
      const linkedin = /linkedin\.com\/in\//.test(hit.href.toLowerCase()) ? normalizeLink(hit.href) : undefined
      const titleMatch = container.match(TITLE_PATTERN)
      const contact: DeterministicContact = {
        fullName: nameCandidate,
        email,
        linkedinUrl: linkedin,
        jobTitle: titleMatch?.[0].replace(/\s+/g, " ").trim() || undefined,
        evidence: [...(email ? (["MAILTO"] as EvidenceType[]) : []), ...(linkedin ? (["LINK"] as EvidenceType[]) : [])],
      }
      result.contacts.push(contact)
      if (email) {
        result.emails.push(email)
        note("email", email, "MAILTO")
      }
    }
  }

  return result
}

function fixUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}