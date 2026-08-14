// TASK 022: CSV import/export (spec §1-§80). Data transport only — no AI,
// no scraping, no enrichment, no scoring, no classification, no analytics.
// Reuses existing normalization, zod validation and the CRM's deduplication
// rules (domain → normalized name for companies; email → linkedin → phone
// for contacts; one lead per (company, contact)). All operations are
// org-scoped and server-authoritative; the commit re-validates every row.

import { parse } from "csv-parse/sync"
import { stringify } from "csv-stringify/sync"
import { prisma } from "@/lib/db"
import { companySchema, contactSchema } from "@/lib/crm/validators"
import { buildFullName, normalizeCompanyName, normalizeDomain } from "@/lib/crm/normalize"
import { normalizeEmail, normalizePhone } from "@/lib/lead-engine/extraction/normalize"
import { normalizeLinkedInUrl } from "@/lib/lead-engine/resolution/normalize"
import { LEAD_SOURCE_OPTIONS } from "@/lib/crm/leads"
import type { Prisma, LeadStatus, LeadPriority } from "@/generated/prisma/client"

export const CSV_MAX_BYTES = Number(process.env.CSV_IMPORT_MAX_BYTES ?? 1_000_000)
export const CSV_MAX_ROWS = 50_000
export const CSV_MAX_COLUMNS = 200
export const CSV_EXPORT_MAX_ROWS = 100_000

const COMPANY_FIELDS = [
  "name",
  "domain",
  "website",
  "industry",
  "employeeCount",
  "employeeRange",
  "revenueRange",
  "country",
  "state",
  "city",
  "description",
  "phone",
  "linkedinUrl",
  "status",
] as const

const CONTACT_FIELDS = ["firstName", "lastName", "jobTitle", "department", "email", "phone", "linkedinUrl"] as const

const LEAD_FIELDS = ["status", "priority", "source", "owner"] as const

export type CsvField =
  | `company.${(typeof COMPANY_FIELDS)[number]}`
  | `contact.${(typeof CONTACT_FIELDS)[number]}`
  | `lead.${(typeof LEAD_FIELDS)[number]}`

const LEAD_STATUSES = ["NEW", "REVIEW", "QUALIFIED", "DISQUALIFIED", "CONTACTED", "ENGAGED", "OPPORTUNITY", "CONVERTED", "LOST"]
const LEAD_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"]

// Protected/derived intelligence columns may appear in a file but are never
// mapped — surfaced in the UI as read-only (spec §22).
const PROTECTED_COLUMNS = [
  "organizationid",
  "orgid",
  "tenantid",
  "tenant",
  "score",
  "leadscore",
  "fitscore",
  "intentscore",
  "engagementscore",
  "qualification",
  "classification",
  "signal",
  "signals",
  "research",
  "evidence",
  "ai",
  "createdat",
  "updatedat",
]

const ALIASES: Record<string, CsvField> = {
  companyname: "company.name",
  company: "company.name",
  organization: "company.name",
  organizationname: "company.name",
  account: "company.name",
  name: "company.name",
  domain: "company.domain",
  companydomain: "company.domain",
  websitedomain: "company.domain",
  website: "company.website",
  websiteurl: "company.website",
  companywebsite: "company.website",
  web: "company.website",
  url: "company.website",
  industry: "company.industry",
  companyindustry: "company.industry",
  sector: "company.industry",
  employees: "company.employeeCount",
  employeecount: "company.employeeCount",
  employeescount: "company.employeeCount",
  headcount: "company.employeeCount",
  employeerange: "company.employeeRange",
  companysize: "company.employeeRange",
  size: "company.employeeRange",
  revenuerange: "company.revenueRange",
  revenue: "company.revenueRange",
  annualrevenue: "company.revenueRange",
  country: "company.country",
  companycountry: "company.country",
  state: "company.state",
  region: "company.state",
  province: "company.state",
  city: "company.city",
  companycity: "company.city",
  description: "company.description",
  companydescription: "company.description",
  about: "company.description",
  companyphone: "company.phone",
  firstname: "contact.firstName",
  first: "contact.firstName",
  givenname: "contact.firstName",
  lastname: "contact.lastName",
  last: "contact.lastName",
  surname: "contact.lastName",
  jobtitle: "contact.jobTitle",
  title: "contact.jobTitle",
  role: "contact.jobTitle",
  position: "contact.jobTitle",
  designation: "contact.jobTitle",
  department: "contact.department",
  email: "contact.email",
  emailaddress: "contact.email",
  emailaddress1: "contact.email",
  emailid: "contact.email",
  contactphone: "contact.phone",
  mobile: "contact.phone",
  phonenumber: "contact.phone",
  contactlinkedin: "contact.linkedinUrl",
  linkedinprofile: "contact.linkedinUrl",
  status: "lead.status",
  leadstatus: "lead.status",
  stage: "lead.status",
  pipelinestage: "lead.status",
  priority: "lead.priority",
  leadpriority: "lead.priority",
  source: "lead.source",
  leadsource: "lead.source",
  origin: "lead.source",
  owner: "lead.owner",
  owneremail: "lead.owner",
  assignedto: "lead.owner",
  rep: "lead.owner",
}

// Ambiguous headers must be mapped by the user; never guessed (§55).
const AMBIGUOUS_HEADERS = new Set(["phone", "linkedin", "linkedinurl"])

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "")
}

// ── Parsing (csv-parse handles quotes, commas, newlines, escapes, BOM) ───

export function parseCsv(input: string): { headers: string[]; rows: string[][] } {
  if (Buffer.byteLength(input, "utf8") > CSV_MAX_BYTES) {
    throw new Error(`File is too large. Maximum size is ${Math.round(CSV_MAX_BYTES / 1_000_000)}MB.`)
  }
  let records: string[][]
  try {
    records = parse(input, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true })
  } catch {
    throw new Error("Could not parse this CSV file. Check that it is valid CSV and try again.")
  }
  if (records.length === 0) throw new Error("The CSV file is empty.")
  const headers = records[0].map((h) => (h ?? "").trim())
  if (headers.length === 0 || headers.every((h) => !h)) throw new Error("The CSV file has no headers.")
  if (headers.length > CSV_MAX_COLUMNS) throw new Error("The CSV file has too many columns.")
  const rows = records
    .slice(1)
    .filter((row) => row.some((cell) => (cell ?? "").trim() !== ""))
    .slice(0, CSV_MAX_ROWS)
  if (rows.length === 0) throw new Error("The CSV file has no data rows.")
  return { headers, rows }
}

// ── Auto-mapping ─────────────────────────────────────────────────────────

export interface MappingResult {
  mapping: Record<string, string>
  ambiguous: string[]
  protectedColumns: string[]
  unknownColumns: string[]
}

export function autoMapHeaders(headers: string[]): MappingResult {
  const mapping: Record<string, string> = {}
  const ambiguous: string[] = []
  const protectedColumns: string[] = []
  const unknownColumns: string[] = []
  for (const header of headers) {
    const key = normalizeHeader(header)
    if (PROTECTED_COLUMNS.includes(key)) {
      protectedColumns.push(header)
      mapping[header] = ""
      continue
    }
    if (AMBIGUOUS_HEADERS.has(key)) {
      ambiguous.push(header)
      mapping[header] = ""
      continue
    }
    const field = ALIASES[key]
    mapping[header] = field ?? ""
    if (!field) unknownColumns.push(header)
  }
  return { mapping, ambiguous, protectedColumns, unknownColumns }
}

export const MAPPABLE_OPTIONS: { label: string; value: string }[] = [
  { label: "Company name", value: "company.name" },
  { label: "Domain", value: "company.domain" },
  { label: "Website", value: "company.website" },
  { label: "Company status", value: "company.status" },
  { label: "Industry", value: "company.industry" },
  { label: "Employees (count)", value: "company.employeeCount" },
  { label: "Employees (range)", value: "company.employeeRange" },
  { label: "Revenue (range)", value: "company.revenueRange" },
  { label: "Country", value: "company.country" },
  { label: "State", value: "company.state" },
  { label: "City", value: "company.city" },
  { label: "Description", value: "company.description" },
  { label: "Company phone", value: "company.phone" },
  { label: "LinkedIn (company)", value: "company.linkedinUrl" },
  { label: "Contact first name", value: "contact.firstName" },
  { label: "Contact last name", value: "contact.lastName" },
  { label: "Job title", value: "contact.jobTitle" },
  { label: "Department", value: "contact.department" },
  { label: "Email", value: "contact.email" },
  { label: "Phone", value: "contact.phone" },
  { label: "LinkedIn (contact)", value: "contact.linkedinUrl" },
  { label: "Lead status", value: "lead.status" },
  { label: "Lead priority", value: "lead.priority" },
  { label: "Lead source", value: "lead.source" },
  { label: "Owner", value: "lead.owner" },
]

// ── Row validation (reuses existing zod schemas) ─────────────────────────

export interface RowError {
  field: string
  error: string
}

interface ParsedRow {
  company: Record<string, string>
  contact: Record<string, string>
  lead: Record<string, string>
}

function rowValues(row: string[], headers: string[], mapping: Record<string, string>): ParsedRow {
  const out: ParsedRow = { company: {}, contact: {}, lead: {} }
  headers.forEach((header, index) => {
    const field = mapping[header]
    const value = (row[index] ?? "").trim()
    if (!field || !value) return
    const [entity, name] = field.split(".") as ["company" | "contact" | "lead", string]
    if (entity === "company" && (COMPANY_FIELDS as readonly string[]).includes(name)) out.company[name] = value
    if (entity === "contact" && (CONTACT_FIELDS as readonly string[]).includes(name)) out.contact[name] = value
    if (entity === "lead" && (LEAD_FIELDS as readonly string[]).includes(name)) out.lead[name] = value
  })
  return out
}

function validateCompany(values: Record<string, string>): RowError[] {
  const errors: RowError[] = []
  if (Object.keys(values).length > 0 && !values.name) {
    errors.push({ field: "company.name", error: "Company name is required when importing companies" })
  }
  // z.url() rejects bare domains ("northwind.io") — CSV files usually have
  // those, so normalize to a URL before the zod check (stored value stays raw).
  const zodValues = { ...values }
  for (const key of ["domain", "website"] as const) {
    const raw = values[key]
    if (raw && !/^https?:\/\//.test(raw)) {
      const normalized = normalizeDomain(raw)
      if (normalized) zodValues[key] = `https://${normalized}`
    }
  }
  const parsed = companySchema.partial().safeParse(zodValues)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: `company.${issue.path.join(".")}`, error: issue.message })
    }
  }
  for (const key of ["domain", "website"] as const) {
    if (values[key] && !normalizeDomain(values[key])) {
      errors.push({ field: `company.${key}`, error: "Invalid domain or URL" })
    }
  }
  return errors
}

function validateContact(values: Record<string, string>): RowError[] {
  const errors: RowError[] = []
  if (Object.keys(values).length > 0 && !values.firstName) {
    errors.push({ field: "contact.firstName", error: "Contact first name is required when importing contacts" })
  }
  const zodValues = { ...values }
  const linkedin = values.linkedinUrl
  if (linkedin && !/^https?:\/\//.test(linkedin)) {
    const normalized = normalizeLinkedInUrl(linkedin)
    if (normalized) zodValues.linkedinUrl = `https://${normalized}`
  }
  const parsed = contactSchema.partial().safeParse(zodValues)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ field: `contact.${issue.path.join(".")}`, error: issue.message })
    }
  }
  if (values.linkedinUrl && !normalizeLinkedInUrl(values.linkedinUrl)) {
    errors.push({ field: "contact.linkedinUrl", error: "Invalid LinkedIn URL" })
  }
  return errors
}

function validateLead(values: Record<string, string>, users: { id: string; name: string; email: string }[]): RowError[] {
  const errors: RowError[] = []
  if (values.status && !LEAD_STATUSES.includes(values.status.toUpperCase())) {
    errors.push({ field: "lead.status", error: `Invalid lead status "${values.status}". Allowed: ${LEAD_STATUSES.join(", ")}` })
  }
  if (values.priority && !LEAD_PRIORITIES.includes(values.priority.toUpperCase())) {
    errors.push({ field: "lead.priority", error: `Invalid priority "${values.priority}". Allowed: ${LEAD_PRIORITIES.join(", ")}` })
  }
  if (values.source && !LEAD_SOURCE_OPTIONS.includes(values.source.toUpperCase() as never)) {
    errors.push({ field: "lead.source", error: `Invalid source "${values.source}". Allowed: ${LEAD_SOURCE_OPTIONS.join(", ")}` })
  }
  if (values.owner) {
    const owner = resolveOwner(users, values.owner)
    if ("error" in owner) errors.push({ field: "lead.owner", error: owner.error })
  }
  return errors
}

export function validateRow(parsed: ParsedRow, users: { id: string; name: string; email: string }[]): RowError[] {
  if (Object.keys(parsed.company).length === 0 && Object.keys(parsed.contact).length === 0 && Object.keys(parsed.lead).length === 0) {
    return [{ field: "row", error: "No mapped data in this CSV row" }]
  }
  return [...validateCompany(parsed.company), ...validateContact(parsed.contact), ...validateLead(parsed.lead, users)]
}

// ── Deduplication (existing CRM rules, org-scoped) ────────────────────────

export type CompanyMatchResult =
  | { status: "EXISTING"; companyId: string; reason: string }
  | { status: "AMBIGUOUS"; reason: string }
  | { status: "NEW" }

export async function resolveCompany(
  orgId: string,
  values: Record<string, string>,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<CompanyMatchResult> {
  const domain = values.domain || values.website ? normalizeDomain(values.domain || values.website) : null
  if (domain) {
    const byDomain = await db.company.findFirst({ where: { organizationId: orgId, domain } })
    if (byDomain) return { status: "EXISTING", companyId: byDomain.id, reason: "Matched by domain" }
  }
  if (values.name) {
    const normalizedName = normalizeCompanyName(values.name)
    const byName = await db.company.findMany({ where: { organizationId: orgId, normalizedName }, orderBy: { createdAt: "asc" } })
    if (byName.length === 1) {
      const exact = byName[0]
      // §52: a conflicting domain on the name match is ambiguity, not identity.
      if (domain && exact.domain && exact.domain !== domain) {
        return { status: "AMBIGUOUS", reason: "A company with this name already exists under a different domain" }
      }
      return { status: "EXISTING", companyId: exact.id, reason: "Matched by company name" }
    }
    if (byName.length > 1) {
      return { status: "AMBIGUOUS", reason: "Multiple companies with this name exist — add a domain to disambiguate" }
    }
  }
  return { status: "NEW" }
}

export type ContactMatchResult =
  | { status: "EXISTING"; contactId: string; reason: string }
  | { status: "NEW" }

export async function resolveContact(
  orgId: string,
  values: Record<string, string>,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<ContactMatchResult> {
  const email = values.email ? normalizeEmail(values.email) : null
  if (email) {
    const byEmail = await db.contact.findFirst({ where: { organizationId: orgId, email } })
    if (byEmail) return { status: "EXISTING", contactId: byEmail.id, reason: "Matched by email" }
  }
  const linkedin = values.linkedinUrl ? normalizeLinkedInUrl(values.linkedinUrl) : null
  if (linkedin) {
    const byLinkedin = await db.contact.findFirst({ where: { organizationId: orgId, linkedinUrl: linkedin } })
    if (byLinkedin) return { status: "EXISTING", contactId: byLinkedin.id, reason: "Matched by LinkedIn" }
  }
  const phone = values.phone ? normalizePhone(values.phone) : null
  if (phone) {
    const byPhone = await db.contact.findFirst({ where: { organizationId: orgId, phone } })
    if (byPhone) return { status: "EXISTING", contactId: byPhone.id, reason: "Matched by phone" }
  }
  return { status: "NEW" }
}

function leadKey(companyId: string, contactId: string | null): string {
  return `${companyId}:${contactId ?? ""}`
}

export function resolveOwner(
  users: { id: string; name: string; email: string }[],
  value: string | undefined,
): { userId: string } | { error: string } {
  if (!value) return { userId: "" }
  const email = normalizeEmail(value)
  if (email) {
    const user = users.find((u) => u.email.toLowerCase() === email)
    if (user) return { userId: user.id }
  }
  const byName = users.find((u) => u.name.toLowerCase() === value.trim().toLowerCase())
  if (byName) return { userId: byName.id }
  return { error: `Owner "${value}" not found in this organization` }
}

// ── Preview (validates the complete file server-side, §57) ───────────────

export type RowStatus = "NEW" | "EXISTING" | "DUPLICATE" | "INVALID"

export interface CsvSampleRow {
  row: number
  status: RowStatus
  values: string[]
  matchReason?: string
  errors: RowError[]
}

export interface CsvPreview {
  headers: string[]
  mapping: Record<string, string>
  ambiguousColumns: string[]
  protectedColumns: string[]
  unknownColumns: string[]
  totalRows: number
  validRows: number
  newRows: number
  existingRows: number
  duplicateRows: number
  invalidRows: number
  sample: CsvSampleRow[]
}

interface PreviewLocks {
  companiesByDomain: Map<string, string>
  companiesByName: Map<string, { id: string; domain: string | null }[]>
  contactsByEmail: Map<string, string>
  contactsByLinkedin: Map<string, string>
  contactsByPhone: Map<string, string>
}

async function loadPreviewLocks(orgId: string, rows: ParsedRow[]): Promise<PreviewLocks> {
  const domains = new Set<string>()
  const names = new Set<string>()
  const emails = new Set<string>()
  const linkedins = new Set<string>()
  const phones = new Set<string>()
  for (const row of rows) {
    const domain = row.company.domain || row.company.website ? normalizeDomain(row.company.domain || row.company.website) : null
    if (domain) domains.add(domain)
    if (row.company.name) names.add(normalizeCompanyName(row.company.name))
    const email = row.contact.email ? normalizeEmail(row.contact.email) : null
    if (email) emails.add(email)
    const linkedin = row.contact.linkedinUrl ? normalizeLinkedInUrl(row.contact.linkedinUrl) : null
    if (linkedin) linkedins.add(linkedin)
    const phone = row.contact.phone ? normalizePhone(row.contact.phone) : null
    if (phone) phones.add(phone)
  }
  const [byDomain, byName, byEmail, byLinkedin, byPhone] = await Promise.all([
    domains.size > 0
      ? prisma.company.findMany({ where: { organizationId: orgId, domain: { in: [...domains] } }, select: { id: true, domain: true } })
      : Promise.resolve([] as { id: string; domain: string | null }[]),
    names.size > 0
      ? prisma.company.findMany({
          where: { organizationId: orgId, normalizedName: { in: [...names] } },
          select: { id: true, domain: true, normalizedName: true },
        })
      : Promise.resolve([] as { id: string; domain: string | null; normalizedName: string }[]),
    emails.size > 0
      ? prisma.contact.findMany({ where: { organizationId: orgId, email: { in: [...emails] } }, select: { id: true, email: true } })
      : Promise.resolve([] as { id: string; email: string }[]),
    linkedins.size > 0
      ? prisma.contact.findMany({ where: { organizationId: orgId, linkedinUrl: { in: [...linkedins] } }, select: { id: true, linkedinUrl: true } })
      : Promise.resolve([] as { id: string; linkedinUrl: string | null }[]),
    phones.size > 0
      ? prisma.contact.findMany({ where: { organizationId: orgId, phone: { in: [...phones] } }, select: { id: true, phone: true } })
      : Promise.resolve([] as { id: string; phone: string | null }[]),
  ])
  const byNameMap = new Map<string, { id: string; domain: string | null }[]>()
  for (const company of byName) {
    const list = byNameMap.get(company.normalizedName) ?? []
    list.push(company)
    byNameMap.set(company.normalizedName, list)
  }
  return {
    companiesByDomain: new Map(byDomain.map((c) => [c.domain ?? "", c.id])),
    companiesByName: byNameMap,
    contactsByEmail: new Map(byEmail.flatMap((c) => (c.email !== null ? [[c.email, c.id] as const] : []))),
    contactsByLinkedin: new Map(byLinkedin.map((c) => [c.linkedinUrl ?? "", c.id])),
    contactsByPhone: new Map(byPhone.map((c) => [c.phone ?? "", c.id])),
  }
}

export async function previewCsvImport(
  orgId: string,
  csv: string,
  mapping: Record<string, string>,
): Promise<CsvPreview> {
  const { headers, rows } = parseCsv(csv)
  const auto = autoMapHeaders(headers)
  const effective: Record<string, string> = {}
  for (const header of headers) {
    const chosen = mapping[header] ?? auto.mapping[header] ?? ""
    if (!PROTECTED_COLUMNS.includes(normalizeHeader(header)) && chosen) effective[header] = chosen
  }
  const users = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, email: true } })
  const parsedRows = rows.map((row) => rowValues(row, headers, effective))
  const errors = parsedRows.map((parsed) => validateRow(parsed, users))
  const locks = await loadPreviewLocks(orgId, parsedRows)

  const companyMemo = new Map<string, string>()
  const contactMemo = new Map<string, string>()
  const leadMemo = new Set<string>()
  const statuses: RowStatus[] = []
  const reasons: (string | undefined)[] = []

  for (let i = 0; i < parsedRows.length; i += 1) {
    const parsed = parsedRows[i]
    if (errors[i].length > 0) {
      statuses.push("INVALID")
      reasons.push(undefined)
      continue
    }
    const hasCompany = Object.keys(parsed.company).length > 0
    const hasContact = Object.keys(parsed.contact).length > 0
    const hasLead = Object.keys(parsed.lead).length > 0
    const domain = parsed.company.domain || parsed.company.website ? normalizeDomain(parsed.company.domain || parsed.company.website) : null
    const normalizedName = parsed.company.name ? normalizeCompanyName(parsed.company.name) : null
    const companyKey = `${domain ?? ""}|${normalizedName ?? ""}`

    let companyId: string | null = null
    let companyFromMemo = false
    if (companyMemo.has(companyKey)) {
      companyId = companyMemo.get(companyKey)!
      companyFromMemo = true
    } else if (hasCompany) {
      if (domain && locks.companiesByDomain.has(domain)) {
        companyId = locks.companiesByDomain.get(domain)!
        companyMemo.set(companyKey, companyId)
      } else if (normalizedName) {
        const byName = locks.companiesByName.get(normalizedName)
        if (byName && byName.length === 1 && !(domain && byName[0].domain && byName[0].domain !== domain)) {
          companyId = byName[0].id
          companyMemo.set(companyKey, companyId)
        }
      }
    }
    if (!companyId && (hasContact || hasLead) && !hasCompany) {
      errors[i].push({ field: "company", error: "Lead or contact requires a company — add company name, domain or website" })
      statuses.push("INVALID")
      reasons.push(undefined)
      continue
    }

    let contactId: string | null = null
    let contactFromMemo = false
    const contactEmail = parsed.contact.email ? normalizeEmail(parsed.contact.email) : null
    const contactLinkedin = parsed.contact.linkedinUrl ? normalizeLinkedInUrl(parsed.contact.linkedinUrl) : null
    const contactPhone = parsed.contact.phone ? normalizePhone(parsed.contact.phone) : null
    const contactKey = `${contactEmail ?? ""}|${contactLinkedin ?? ""}|${contactPhone ?? ""}`
    if (hasContact) {
      const memoContact = contactMemo.get(contactKey)
      if (memoContact) {
        contactId = memoContact
        contactFromMemo = true
      } else if (companyId && contactEmail && locks.contactsByEmail.has(contactEmail)) {
        contactId = locks.contactsByEmail.get(contactEmail)!
        contactMemo.set(contactKey, contactId)
      } else if (companyId && contactLinkedin && locks.contactsByLinkedin.has(contactLinkedin)) {
        contactId = locks.contactsByLinkedin.get(contactLinkedin)!
        contactMemo.set(contactKey, contactId)
      } else if (companyId && contactPhone && locks.contactsByPhone.has(contactPhone)) {
        contactId = locks.contactsByPhone.get(contactPhone)!
        contactMemo.set(contactKey, contactId)
      } else {
        // New contact — will be created; memo the file key so a repeat of the
        // same contact later in the file is caught (importRow skips it).
        contactMemo.set(contactKey, contactKey)
      }
    }
    // Unmatched entities aren't in the DB yet — use their file-level key so
    // two different new rows don't collide on null ids.
    const leadIdentity = `${companyId ?? companyKey}|${contactId ?? contactKey}`

    if (leadMemo.has(leadIdentity)) {
      statuses.push("DUPLICATE")
      reasons.push("Duplicate within file (same company and contact)")
      continue
    }
    if (hasContact && contactFromMemo) {
      statuses.push("DUPLICATE")
      reasons.push("Duplicate within file (same contact)")
      continue
    }
    if (hasContact && contactId) {
      statuses.push("EXISTING")
      reasons.push("Matched existing contact")
      continue
    }
    if (hasCompany && companyId && !companyFromMemo) {
      statuses.push("EXISTING")
      reasons.push("Matched existing company")
      continue
    }
    if (hasLead) leadMemo.add(leadIdentity)
    statuses.push("NEW")
    reasons.push(undefined)
  }

  let newRows = 0
  let existingRows = 0
  let duplicateRows = 0
  const invalidIndexes: number[] = []
  for (let i = 0; i < statuses.length; i += 1) {
    if (statuses[i] === "NEW") newRows += 1
    else if (statuses[i] === "EXISTING") existingRows += 1
    else if (statuses[i] === "DUPLICATE") duplicateRows += 1
    else invalidIndexes.push(i)
  }

  const sample: CsvSampleRow[] = []
  for (let i = 0; i < Math.min(10, rows.length); i += 1) {
    sample.push({ row: i + 2, status: statuses[i], values: rows[i], matchReason: reasons[i], errors: errors[i] })
  }
  for (const i of invalidIndexes.slice(0, 10)) {
    if (!sample.some((s) => s.row === i + 2)) {
      sample.push({ row: i + 2, status: "INVALID", values: rows[i].slice(0, 6), errors: errors[i] })
    }
  }

  return {
    headers,
    mapping: effective,
    ambiguousColumns: auto.ambiguous,
    protectedColumns: auto.protectedColumns,
    unknownColumns: auto.unknownColumns,
    totalRows: rows.length,
    validRows: rows.length - invalidIndexes.length,
    newRows,
    existingRows,
    duplicateRows,
    invalidRows: invalidIndexes.length,
    sample: sample.slice(0, 12),
  }
}

// ── Import (server-authoritative, per-row transactions) ──────────────────

export type CsvStrategy = "CREATE" | "SKIP" | "UPDATE"

export interface CsvImportResult {
  totalRows: number
  created: number
  updated: number
  skipped: number
  duplicates: number
  failed: number
  failures: { row: number; field: string; error: string }[]
}

type RowOutcome = { kind: "CREATED" } | { kind: "UPDATED" } | { kind: "SKIPPED" | "DUPLICATE"; reason: string }

class RowImportError extends Error {
  readonly row: number
  readonly field: string

  constructor(row: number, field: string, error: string) {
    super(error)
    this.row = row
    this.field = field
  }
}

function companyCreateData(orgId: string, values: Record<string, string>) {
  const { name, website, ...rest } = values
  return {
    organizationId: orgId,
    name: name!,
    normalizedName: normalizeCompanyName(name!),
    domain: values.domain || website ? normalizeDomain(values.domain || website) : undefined,
    website: website ?? undefined,
    ...rest,
  }
}

function companyUpdateData(values: Record<string, string>): Prisma.CompanyUncheckedUpdateInput {
  const { name, website, ...rest } = values
  return {
    ...(name ? { name, normalizedName: normalizeCompanyName(name) } : {}),
    ...(website ? { website } : {}),
    ...rest,
  }
}

function contactCreateData(orgId: string, values: Record<string, string>, companyId: string) {
  const { firstName, lastName, ...rest } = values
  return {
    organizationId: orgId,
    companyId,
    firstName: firstName!,
    lastName: lastName ?? undefined,
    fullName: buildFullName(firstName!, lastName ?? ""),
    ...rest,
    email: values.email ? normalizeEmail(values.email) : undefined,
    phone: values.phone ? normalizePhone(values.phone) : undefined,
    linkedinUrl: values.linkedinUrl ? normalizeLinkedInUrl(values.linkedinUrl) : undefined,
  }
}

function contactUpdateData(values: Record<string, string>): Prisma.ContactUncheckedUpdateInput {
  const { firstName, lastName, ...rest } = values
  return {
    ...(firstName ? { firstName, fullName: buildFullName(firstName, lastName ?? undefined) } : {}),
    ...(lastName ? { lastName } : {}),
    ...rest,
    ...(values.email ? { email: normalizeEmail(values.email) ?? undefined } : {}),
    ...(values.phone ? { phone: normalizePhone(values.phone) ?? undefined } : {}),
    ...(values.linkedinUrl ? { linkedinUrl: normalizeLinkedInUrl(values.linkedinUrl) ?? undefined } : {}),
  }
}

function leadCreateData(
  orgId: string,
  values: Record<string, string>,
  ownerId: string | undefined,
  companyId: string,
  contactId: string | null,
): Prisma.LeadUncheckedCreateInput {
  return {
    organizationId: orgId,
    companyId,
    contactId,
    status: (values.status ? values.status.toUpperCase() : "NEW") as LeadStatus,
    priority: (values.priority ? values.priority.toUpperCase() : "MEDIUM") as LeadPriority,
    source: values.source ? values.source.toUpperCase() : "IMPORT",
    ownerId,
  }
}

function leadUpdateData(values: Record<string, string>, ownerId: string | undefined): Prisma.LeadUncheckedUpdateInput {
  return {
    ...(values.status ? { status: values.status.toUpperCase() as LeadStatus } : {}),
    ...(values.priority ? { priority: values.priority.toUpperCase() as LeadPriority } : {}),
    ...(values.source ? { source: values.source.toUpperCase() } : {}),
    ...(values.owner ? { ownerId } : {}),
  }
}

async function importRow(
  orgId: string,
  rowNumber: number,
  parsed: ParsedRow,
  strategy: CsvStrategy,
  users: { id: string; name: string; email: string }[],
  memo: { companies: Map<string, string>; contacts: Map<string, string>; leads: Map<string, string> },
): Promise<RowOutcome> {
  const validationErrors = validateRow(parsed, users)
  if (validationErrors.length > 0) {
    throw new RowImportError(rowNumber, validationErrors[0].field, validationErrors[0].error)
  }
  const hasCompany = Object.keys(parsed.company).length > 0
  const hasContact = Object.keys(parsed.contact).length > 0
  const hasLead = Object.keys(parsed.lead).length > 0
  const domain = parsed.company.domain || parsed.company.website ? normalizeDomain(parsed.company.domain || parsed.company.website) : null
  const normalizedName = parsed.company.name ? normalizeCompanyName(parsed.company.name) : null
  const companyKey = `${domain ?? ""}|${normalizedName ?? ""}`

  const owner =
    hasLead && parsed.lead.owner ? resolveOwner(users, parsed.lead.owner) : { userId: "" }
  if ("error" in owner) throw new RowImportError(rowNumber, "lead.owner", owner.error)
  const ownerId = owner.userId || undefined

  return prisma.$transaction(async (tx) => {
    // 1. Company
    let companyId: string | null = memo.companies.get(companyKey) ?? null
    if (!companyId && hasCompany) {
      const match = await resolveCompany(orgId, parsed.company, tx)
      if (match.status === "AMBIGUOUS") throw new RowImportError(rowNumber, "company.name", match.reason)
      if (match.status === "EXISTING") {
        if (strategy === "SKIP") return { kind: "DUPLICATE", reason: match.reason } as RowOutcome
        if (strategy === "UPDATE") {
          await tx.company.update({ where: { id: match.companyId }, data: companyUpdateData(parsed.company) })
          memo.companies.set(companyKey, match.companyId)
          companyId = match.companyId
        } else {
          const created = await tx.company.create({ data: companyCreateData(orgId, parsed.company) })
          memo.companies.set(companyKey, created.id)
          companyId = created.id
        }
      } else {
        const created = await tx.company.create({ data: companyCreateData(orgId, parsed.company) })
        memo.companies.set(companyKey, created.id)
        companyId = created.id
      }
    }
    if (!companyId && (hasContact || hasLead)) {
      throw new RowImportError(rowNumber, "company", "Lead or contact requires a company — add company name, domain or website")
    }

    // 2. Contact
    let contactId: string | null = null
    if (hasContact && companyId) {
      const email = parsed.contact.email ? normalizeEmail(parsed.contact.email) : null
      const linkedin = parsed.contact.linkedinUrl ? normalizeLinkedInUrl(parsed.contact.linkedinUrl) : null
      const phone = parsed.contact.phone ? normalizePhone(parsed.contact.phone) : null
      const contactKey = `${email ?? ""}|${linkedin ?? ""}|${phone ?? ""}`
      const memoContact = memo.contacts.get(contactKey)
      if (memoContact) {
        // §54: an earlier row in this file already created this contact.
        return { kind: "SKIPPED", reason: "Duplicate within file (same contact)" } as RowOutcome
      }
      const match = await resolveContact(orgId, parsed.contact, tx)
      if (match.status === "EXISTING") {
        if (strategy === "SKIP") return { kind: "DUPLICATE", reason: match.reason } as RowOutcome
        if (strategy === "UPDATE") {
          await tx.contact.update({ where: { id: match.contactId }, data: contactUpdateData(parsed.contact) })
          contactId = match.contactId
        } else {
          const created = await tx.contact.create({ data: contactCreateData(orgId, parsed.contact, companyId) })
          contactId = created.id
        }
      } else {
        const created = await tx.contact.create({ data: contactCreateData(orgId, parsed.contact, companyId) })
        contactId = created.id
      }
      memo.contacts.set(contactKey, contactId)
    }

    // 3. Lead — one per (company, contact) (§53)
    if (companyId && (hasLead || hasContact)) {
      const key = leadKey(companyId, contactId)
      if (memo.leads.has(key)) {
        return { kind: "SKIPPED", reason: "Duplicate within file (same company and contact)" } as RowOutcome
      }
      const existingLead = await tx.lead.findFirst({
        where: { organizationId: orgId, companyId, contactId },
        orderBy: { createdAt: "asc" },
      })
      if (existingLead) {
        if (strategy === "SKIP") return { kind: "DUPLICATE", reason: "Matched existing lead" } as RowOutcome
        if (strategy === "UPDATE") {
          await tx.lead.update({ where: { id: existingLead.id }, data: leadUpdateData(parsed.lead, ownerId) })
          memo.leads.set(key, "x")
          return { kind: "UPDATED" } as RowOutcome
        }
        await tx.lead.create({ data: leadCreateData(orgId, parsed.lead, ownerId, companyId, contactId) })
        memo.leads.set(key, "x")
        return { kind: "CREATED" } as RowOutcome
      }
      await tx.lead.create({ data: leadCreateData(orgId, parsed.lead, ownerId, companyId, contactId) })
      memo.leads.set(key, "x")
      return { kind: "CREATED" } as RowOutcome
    }

    // 4. Row outcome
    if (companyId && strategy === "UPDATE") return { kind: "UPDATED" } as RowOutcome
    return { kind: "CREATED" } as RowOutcome
  })
}

export async function importCsvRows(
  orgId: string,
  csv: string,
  mapping: Record<string, string>,
  strategy: CsvStrategy,
): Promise<CsvImportResult> {
  const { headers, rows } = parseCsv(csv)
  const auto = autoMapHeaders(headers)
  const effective: Record<string, string> = {}
  for (const header of headers) {
    const chosen = mapping[header] ?? auto.mapping[header] ?? ""
    if (!PROTECTED_COLUMNS.includes(normalizeHeader(header)) && chosen) effective[header] = chosen
  }
  const users = await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true, email: true } })
  const memo = { companies: new Map<string, string>(), contacts: new Map<string, string>(), leads: new Map<string, string>() }
  const result: CsvImportResult = { totalRows: rows.length, created: 0, updated: 0, skipped: 0, duplicates: 0, failed: 0, failures: [] }

  for (let i = 0; i < rows.length; i += 1) {
    const parsed = rowValues(rows[i], headers, effective)
    try {
      const outcome = await importRow(orgId, i + 2, parsed, strategy, users, memo)
      if (outcome.kind === "CREATED") result.created += 1
      else if (outcome.kind === "UPDATED") result.updated += 1
      else if (outcome.kind === "SKIPPED") result.skipped += 1
      else result.duplicates += 1
    } catch (e) {
      result.failed += 1
      if (e instanceof RowImportError) {
        result.failures.push({ row: e.row, field: e.field, error: e.message })
      } else if (e instanceof Error && "code" in e && (e as { code: string }).code === "P2002") {
        result.failures.push({ row: i + 2, field: "record", error: "A record with these details already exists" })
      } else {
        result.failures.push({ row: i + 2, field: "record", error: "Row could not be imported" })
      }
    }
  }
  return result
}

// ── Export (org-scoped, existing filters reused, §48 formula safety) ─────

const FORMULA_START = /^[=+\-@\t\r]/

export function safeCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return ""
  return FORMULA_START.test(value) ? `'${value}` : value
}

export const LEAD_EXPORT_HEADERS = [
  "Lead ID",
  "Company",
  "Domain",
  "Website",
  "Contact",
  "Job title",
  "Email",
  "Phone",
  "Industry",
  "Country",
  "City",
  "Employees",
  "Status",
  "Priority",
  "Source",
  "Owner",
  "Score",
  "Classification",
] as const

export type LeadExportRow = Record<(typeof LEAD_EXPORT_HEADERS)[number], string>

export function exportLeadsCsv(rows: LeadExportRow[]): string {
  const clean = rows.map((row) => {
    const out: Record<string, string> = {}
    for (const header of LEAD_EXPORT_HEADERS) out[header] = safeCell(row[header])
    return out
  })
  return stringify(clean, { header: true, columns: [...LEAD_EXPORT_HEADERS] })
}

export function exportFilename(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `leads-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`
}