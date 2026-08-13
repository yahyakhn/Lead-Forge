import { prisma } from "@/lib/db"
import type { LeadInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"
import type { LeadStatus, LeadPriority, EmailStatus } from "@/generated/prisma/client"
import { createActivity } from "@/lib/crm/activities"
import { scoreLead } from "@/lib/lead-engine/scoring/service"

const LEAD_INCLUDE = {
  company: { select: { id: true, name: true, domain: true } },
  contact: { select: { id: true, fullName: true, email: true, jobTitle: true } },
  owner: { select: { id: true, name: true } },
  sourceCandidate: { select: { id: true, companyName: true, contactFullName: true, runId: true } },
} as const

const LEAD_INCLUDE_WITH_SCORES = {
  ...LEAD_INCLUDE,
  scores: {
    where: { scoreStatus: "CURRENT" },
    take: 1,
    orderBy: { scoredAt: "desc" },
    select: { icpScore: true, overallScore: true, qualification: true, scoreBreakdown: true, reasons: true, scoreStatus: true, modelVersion: true, scoredAt: true, icpProfileId: true },
  },
} as const

export const LEAD_SOURCE_OPTIONS = ["MANUAL", "WEBSITE", "SCRAPER", "IMPORT", "REFERRAL"] as const

export async function createLead(orgId: string, input: LeadInput) {
  await requireCompany(orgId, input.companyId)
  await requireContact(orgId, input.contactId)
  await requireOwner(orgId, input.ownerId)
  const lead = await prisma.lead.create({ data: toData(orgId, input), include: LEAD_INCLUDE })
  // TASK 012 §20: new CRM leads get scored when an active ICP exists.
  await scoreLead(orgId, lead.id, { actor: null }).catch(() => null)
  return lead
}

export async function getLead(orgId: string, id: string) {
  return prisma.lead.findFirst({
    where: { id, organizationId: orgId },
    include: LEAD_INCLUDE,
  })
}

export interface LeadFilters {
  page?: number
  pageSize?: number
  status?: string
  priority?: string
  ownerId?: string
  companyId?: string
  contactId?: string
  minScore?: number
  maxScore?: number
  search?: string
  source?: string
  emailStatus?: string
  hasEmail?: boolean
  sortBy?: string
}

export async function listLeads(orgId: string, filters: LeadFilters) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.LeadWhereInput = {
    organizationId: orgId,
    ...(filters.status ? { status: filters.status as LeadStatus } : {}),
    ...(filters.priority ? { priority: filters.priority as LeadPriority } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.source ? { source: filters.source } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.minScore !== undefined ? { score: { gte: filters.minScore } } : {}),
    ...(filters.maxScore !== undefined ? { score: { lte: filters.maxScore } } : {}),
    ...(filters.emailStatus
      ? filters.emailStatus === "STALE"
        ? { emailAddresses: { some: { status: { in: ["VERIFIED", "LIKELY_VALID"] }, expiresAt: { lt: new Date() } } } }
        : { emailAddresses: { some: { status: { equals: filters.emailStatus as EmailStatus } } } }
      : {}),
    ...(filters.hasEmail ? { emailAddresses: { some: {} } } : {}),
    ...(search
      ? {
          OR: [
            { company: { name: { contains: search, mode: "insensitive" } } },
            { company: { domain: { contains: search.toLowerCase() } } },
            { contact: { fullName: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  }
  const [total, data] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: LEAD_INCLUDE_WITH_SCORES,
      orderBy: filters.sortBy === "readiness" ? { contactReadiness: "desc" } : { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateLead(orgId: string, id: string, input: Partial<LeadInput>, userId?: string) {
  const existing = await getLead(orgId, id)
  if (!existing) return null
  await requireCompany(orgId, input.companyId)
  await requireContact(orgId, input.contactId)
  await requireOwner(orgId, input.ownerId)
  if (input.status && input.status !== existing.status) {
    await createActivity(
      orgId,
      {
        type: "STATUS_CHANGE",
        title: `Lead moved from ${existing.status} to ${input.status}`,
        leadId: id,
      },
      userId,
    )
  }
  return prisma.lead.update({ where: { id }, data: toData(orgId, input), include: LEAD_INCLUDE })
}

export async function deleteLead(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.lead.deleteMany({ where: { id, organizationId: orgId } })
  return result.count > 0
}

async function requireCompany(orgId: string, companyId?: string) {
  if (!companyId) return
  const company = await prisma.company.findFirst({ where: { id: companyId, organizationId: orgId } })
  if (!company) throw new Error("Company does not exist in this organization")
}

async function requireContact(orgId: string, contactId?: string) {
  if (!contactId) return
  const contact = await prisma.contact.findFirst({ where: { id: contactId, organizationId: orgId } })
  if (!contact) throw new Error("Contact does not exist in this organization")
}

async function requireOwner(orgId: string, ownerId?: string) {
  if (!ownerId) return
  const owner = await prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId } })
  if (!owner) throw new Error("Owner does not exist in this organization")
}

function toData(orgId: string, input: LeadInput | Partial<LeadInput>) {
  const { ...rest } = input
  return { ...rest, organizationId: orgId }
}