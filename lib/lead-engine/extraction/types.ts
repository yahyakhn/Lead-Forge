// Shared types for the lead extraction pipeline (TASK 008).

export const PAGE_CATEGORIES = [
  "COMPANY_HOME",
  "ABOUT",
  "TEAM",
  "PEOPLE",
  "CONTACT",
  "CAREERS",
  "JOB",
  "PRODUCT",
  "PRICING",
  "BLOG",
  "NEWS",
  "DIRECTORY",
  "SOCIAL_PROFILE",
  "OTHER",
] as const

export type PageCategory = (typeof PAGE_CATEGORIES)[number]

export interface ClassificationInput {
  url: string
  title?: string | null
  headings: string[]
  linkTexts: string[]
}

export interface ClassificationResult {
  category: PageCategory
  score: number
  skip: boolean
  skipReason?: string
}

export type EvidenceType = "JSON_LD" | "VISIBLE_TEXT" | "MAILTO" | "LINK" | "META" | "URL" | "AI"

export interface FieldEvidence {
  field: string
  value: string
  sourceUrl?: string
  evidenceType: EvidenceType
}

// Deterministic extraction result — everything found without AI.
export interface DeterministicResult {
  company: {
    name?: string
    domain?: string
    website?: string
    description?: string
    industry?: string
    country?: string
    region?: string
    city?: string
    logo?: string
  }
  contacts: DeterministicContact[]
  emails: string[]
  phones: { raw: string; normalized?: string }[]
  linkedinUrls: string[]
  socialLinks: string[]
  jobs: JobPosting[]
  evidence: FieldEvidence[]
}

export interface DeterministicContact {
  fullName?: string
  firstName?: string
  lastName?: string
  jobTitle?: string
  email?: string
  phone?: string
  linkedinUrl?: string
  evidence: EvidenceType[]
}

export interface JobPosting {
  title?: NullableString
  hiringOrganization?: NullableString
  location?: NullableString
  datePosted?: NullableString
  employmentType?: NullableString
  description?: NullableString
}

// AI provider contract — the AI returns structured data only; it never
// writes to storage itself.
export interface AIExtractionInput {
  pageUrl: string
  pageTitle: string
  cleanedText: string
}

export type NullableString = string | null | undefined

export interface AIExtractionContact {
  fullName: NullableString
  firstName: NullableString
  lastName: NullableString
  jobTitle: NullableString
  email: NullableString
  phone: NullableString
  linkedinUrl: NullableString
}

export interface AIExtractionResult {
  company: {
    name: NullableString
    domain: NullableString
    website: NullableString
    description: NullableString
    industry: NullableString
    country: NullableString
    region: NullableString
    city: NullableString
  }
  contacts: AIExtractionContact[]
  socialLinks: string[]
  jobs: JobPosting[]
  confidence: number
  usage: { promptChars: number; completionChars: number }
}

export type AIOutcome = { ok: true; result: AIExtractionResult } | { ok: false; error: string }

export interface LeadExtractionAI {
  extract(input: AIExtractionInput): Promise<AIOutcome>
  // False when the provider cannot make calls (e.g. missing API key), which
  // lets the pipeline skip AI without recording a failure.
  configured: boolean
}

// A page as the extraction pipeline sees it (decoupled from the DB row so
// unit tests can pass in-memory HTML).
export interface PageForExtraction {
  id: string
  organizationId: string
  runId: string
  sourceId: string
  url: string
  title: string | null
  html?: string | null
  textContent?: string | null
  metadata: Record<string, unknown> | null
  fetchedAt: Date
}