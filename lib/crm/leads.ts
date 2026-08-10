import { prisma } from "@/lib/db"
import { orgWhere } from "@/lib/crm/scope"
import type { LeadInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"
import type { LeadStatus, LeadPriority } from "@/generated/prisma/client"
import { createActivity } from "@/lib/crm/activities"

const LEAD_INCLUDE = {
  company: { select: { id: true, name: true, domain: true } },
  contact: { select: { id: true, fullName: true, email: true, jobTitle: true } },
  owner: { select: { id: true, name: true } },
} as const

export async function createLead(orgId: string, input: LeadInput) {
  await requireCompany(orgId, input.companyId)
  await requireContact(orgId, input.contactId)
  await requireOwner(orgId, input.ownerId)
  return prisma.lead.create({ data: toData(orgId, input), include: LEAD_INCLUDE })
}

export async function getLead(orgId: string, id: string) {
  return prisma.lead.findFirst({
    where: { id, ...orgWhere(orgId) },
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
}

export async function listLeads(orgId: string, filters: LeadFilters) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.LeadWhereInput = {
    ...orgWhere(orgId),
    ...(filters.status ? { status: filters.status as LeadStatus } : {}),
    ...(filters.priority ? { priority: filters.priority as LeadPriority } : {}),
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
    ...(filters.minScore !== undefined ? { score: { gte: filters.minScore } } : {}),
    ...(filters.maxScore !== undefined ? { score: { lte: filters.maxScore } } : {}),
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
    prisma.lead.findMany({ where, include: LEAD_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
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
  const result = await prisma.lead.deleteMany({ where: { id, ...orgWhere(orgId) } })
  return result.count > 0
}

async function requireCompany(orgId: string, companyId?: string) {
  if (!companyId) return
  const company = await prisma.company.findFirst({ where: { id: companyId, ...orgWhere(orgId) } })
  if (!company) throw new Error("Company does not exist in this organization")
}

async function requireContact(orgId: string, contactId?: string) {
  if (!contactId) return
  const contact = await prisma.contact.findFirst({ where: { id: contactId, ...orgWhere(orgId) } })
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