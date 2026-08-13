import { prisma } from "@/lib/db"
import type { LeadListInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"

export async function createLeadList(orgId: string, input: LeadListInput, createdById?: string) {
  return prisma.leadList.create({
    data: { ...input, organizationId: orgId, createdById },
    include: listInclude(),
  })
}

export async function getLeadList(orgId: string, id: string) {
  return prisma.leadList.findFirst({
    where: { id, organizationId: orgId },
    include: {
      ...listInclude(),
      memberships: {
        orderBy: { createdAt: "desc" },
        include: {
          lead: {
            select: {
              id: true,
              status: true,
              priority: true,
              score: true,
              company: { select: { id: true, name: true, domain: true } },
              contact: { select: { id: true, fullName: true } },
            },
          },
        },
      },
    },
  })
}

export interface LeadListFilters {
  page?: number
  pageSize?: number
  search?: string
}

export async function listLeadLists(orgId: string, filters: LeadListFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.LeadListWhereInput = {
    organizationId: orgId,
    ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.leadList.count({ where }),
    prisma.leadList.findMany({ where, include: listInclude(), orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateLeadList(orgId: string, id: string, input: Partial<LeadListInput>) {
  const existing = await getLeadList(orgId, id)
  if (!existing) return null
  return prisma.leadList.update({ where: { id }, data: input, include: listInclude() })
}

export async function deleteLeadList(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.leadList.deleteMany({ where: { id, organizationId: orgId } })
  return result.count > 0
}

export async function addLeadToList(orgId: string, listId: string, leadId: string) {
  const list = await prisma.leadList.findFirst({ where: { id: listId, organizationId: orgId } })
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } })
  if (!list || !lead) throw new Error("List or lead does not exist in this organization")
  return prisma.leadListMembership.upsert({
    where: { listId_leadId: { listId, leadId } },
    update: {},
    create: { listId, leadId },
  })
}

export async function removeLeadFromList(orgId: string, listId: string, leadId: string) {
  const list = await prisma.leadList.findFirst({ where: { id: listId, organizationId: orgId } })
  if (!list) throw new Error("List does not exist in this organization")
  const result = await prisma.leadListMembership.deleteMany({ where: { listId, leadId } })
  return result.count > 0
}

export async function listLeadListMembershipIds(orgId: string, leadId: string): Promise<string[]> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } })
  if (!lead) return []
  const rows = await prisma.leadListMembership.findMany({
    where: { leadId, list: { organizationId: orgId } },
    select: { listId: true },
  })
  return rows.map((r) => r.listId)
}

function listInclude() {
  return { _count: { select: { memberships: true } } } as const
}