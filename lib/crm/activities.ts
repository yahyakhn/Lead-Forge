import { prisma } from "@/lib/db"
import { orgWhere } from "@/lib/crm/scope"
import type { ActivityInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"

const ACTIVITY_INCLUDE = {
  lead: { select: { id: true, company: { select: { name: true } } } },
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, name: true } },
} as const

export async function createActivity(orgId: string, input: ActivityInput, createdById?: string) {
  await requireRefs(orgId, input)
  const activity = await prisma.activity.create({
    data: { ...input, organizationId: orgId, createdById },
    include: ACTIVITY_INCLUDE,
  })
  if (input.leadId) {
    await prisma.lead.update({
      where: { id: input.leadId },
      data: { lastActivityAt: new Date() },
    })
  }
  return activity
}

export async function getActivity(orgId: string, id: string) {
  return prisma.activity.findFirst({ where: { id, ...orgWhere(orgId) }, include: ACTIVITY_INCLUDE })
}

export interface ActivityFilters {
  page?: number
  pageSize?: number
  leadId?: string
  companyId?: string
  contactId?: string
}

export async function listActivities(orgId: string, filters: ActivityFilters) {
  const { page, pageSize } = parsePagination(filters)
  const where: Prisma.ActivityWhereInput = {
    ...orgWhere(orgId),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.contactId ? { contactId: filters.contactId } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({ where, include: ACTIVITY_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function deleteActivity(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.activity.deleteMany({ where: { id, ...orgWhere(orgId) } })
  return result.count > 0
}

async function requireRefs(orgId: string, input: ActivityInput) {
  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, ...orgWhere(orgId) } })
    if (!lead) throw new Error("Lead does not exist in this organization")
  }
  if (input.companyId) {
    const company = await prisma.company.findFirst({ where: { id: input.companyId, ...orgWhere(orgId) } })
    if (!company) throw new Error("Company does not exist in this organization")
  }
  if (input.contactId) {
    const contact = await prisma.contact.findFirst({ where: { id: input.contactId, ...orgWhere(orgId) } })
    if (!contact) throw new Error("Contact does not exist in this organization")
  }
}