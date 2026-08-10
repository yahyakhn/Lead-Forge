import { prisma } from "@/lib/db"
import { orgWhere } from "@/lib/crm/scope"
import type { DealInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"

const DEAL_INCLUDE = {
  lead: { select: { id: true, company: { select: { id: true, name: true, domain: true } } } },
  company: { select: { id: true, name: true, domain: true } },
  stage: { select: { id: true, name: true, position: true, color: true, isClosed: true, isWon: true } },
  owner: { select: { id: true, name: true } },
} as const

export async function createDeal(orgId: string, input: DealInput) {
  await requireStage(orgId, input.stageId)
  await requireLead(orgId, input.leadId)
  await requireCompany(orgId, input.companyId)
  await requireOwner(orgId, input.ownerId)
  const companyId = input.companyId ?? (input.leadId ? (await prisma.lead.findUnique({ where: { id: input.leadId } }))?.companyId : undefined)
  return prisma.deal.create({
    data: {
      name: input.name,
      value: input.value,
      currency: input.currency,
      stageId: input.stageId,
      leadId: input.leadId,
      companyId: input.companyId ?? companyId ?? undefined,
      ownerId: input.ownerId,
      expectedCloseDate: input.expectedCloseDate,
      description: input.description,
      organizationId: orgId,
    },
    include: DEAL_INCLUDE,
  })
}

export async function getDeal(orgId: string, id: string) {
  return prisma.deal.findFirst({ where: { id, ...orgWhere(orgId) }, include: DEAL_INCLUDE })
}

export interface DealFilters {
  page?: number
  pageSize?: number
  stageId?: string
  leadId?: string
  companyId?: string
}

export async function listDeals(orgId: string, filters: DealFilters) {
  const { page, pageSize } = parsePagination(filters)
  const where = {
    ...orgWhere(orgId),
    ...(filters.stageId ? { stageId: filters.stageId } : {}),
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
  }
  const [total, data] = await Promise.all([
    prisma.deal.count({ where }),
    prisma.deal.findMany({ where, include: DEAL_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateDeal(orgId: string, id: string, input: Partial<DealInput>) {
  const existing = await getDeal(orgId, id)
  if (!existing) return null
  if (input.stageId !== undefined) await requireStage(orgId, input.stageId)
  if (input.leadId !== undefined) await requireLead(orgId, input.leadId)
  if (input.companyId !== undefined) await requireCompany(orgId, input.companyId)
  if (input.ownerId !== undefined) await requireOwner(orgId, input.ownerId)
  return prisma.deal.update({ where: { id }, data: input, include: DEAL_INCLUDE })
}

export async function deleteDeal(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.deal.deleteMany({ where: { id, ...orgWhere(orgId) } })
  return result.count > 0
}

async function requireStage(orgId: string, stageId: string) {
  const stage = await prisma.pipelineStage.findFirst({ where: { id: stageId, ...orgWhere(orgId) } })
  if (!stage) throw new Error("Pipeline stage does not exist in this organization")
}

async function requireLead(orgId: string, leadId?: string) {
  if (!leadId) return
  const lead = await prisma.lead.findFirst({ where: { id: leadId, ...orgWhere(orgId) } })
  if (!lead) throw new Error("Lead does not exist in this organization")
}

async function requireCompany(orgId: string, companyId?: string) {
  if (!companyId) return
  const company = await prisma.company.findFirst({ where: { id: companyId, ...orgWhere(orgId) } })
  if (!company) throw new Error("Company does not exist in this organization")
}

async function requireOwner(orgId: string, ownerId?: string) {
  if (!ownerId) return
  const owner = await prisma.user.findFirst({ where: { id: ownerId, organizationId: orgId } })
  if (!owner) throw new Error("Owner does not exist in this organization")
}