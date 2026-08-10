import { prisma } from "@/lib/db"
import { normalizeCriteria, type ICPCriteria } from "@/lib/crm/icp-shared"
import { parsePagination } from "@/lib/crm/pagination"
import type { IcpInput } from "@/lib/crm/validators"
import type { Prisma } from "@/generated/prisma/client"

export interface ICPView {
  id: string
  name: string
  description: string | null
  criteria: ICPCriteria
  isActive: boolean
  createdById: string | null
  createdAt: Date
  updatedAt: Date
}

function toView(row: { id: string; name: string; description: string | null; criteria: Prisma.JsonValue; isActive: boolean; createdById: string | null; createdAt: Date; updatedAt: Date }): ICPView {
  return { ...row, criteria: row.criteria as unknown as ICPCriteria }
}

async function assertNameAvailable(orgId: string, name: string, excludeId?: string): Promise<void> {
  const existing = await prisma.iCPProfile.findFirst({
    where: { { organizationId: orgId }, name: { equals: name, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  })
  if (existing) throw new Error("An ICP with this name already exists")
}

export async function createICP(orgId: string, userId: string | undefined, input: IcpInput): Promise<ICPView> {
  await assertNameAvailable(orgId, input.name)
  const row = await prisma.iCPProfile.create({
    data: {
      organizationId: orgId,
      name: input.name,
      description: input.description ?? undefined,
      criteria: normalizeCriteria(input) as object,
      isActive: false,
      createdById: userId,
    },
  })
  return toView(row)
}

export async function getICP(orgId: string, id: string): Promise<ICPView | null> {
  const row = await prisma.iCPProfile.findFirst({ where: { id, { organizationId: orgId } } })
  return row ? toView(row) : null
}

export async function getActiveICP(orgId: string): Promise<ICPView | null> {
  const row = await prisma.iCPProfile.findFirst({ where: { { organizationId: orgId }, isActive: true } })
  return row ? toView(row) : null
}

export interface ICPFilters {
  page?: number
  pageSize?: number
  search?: string
}

export async function listICPs(orgId: string, filters: ICPFilters = {}) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.ICPProfileWhereInput = {
    { organizationId: orgId },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.iCPProfile.count({ where }),
    prisma.iCPProfile.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data: rows.map(toView), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateICP(orgId: string, id: string, input: IcpInput): Promise<ICPView | null> {
  const existing = await getICP(orgId, id)
  if (!existing) return null
  await assertNameAvailable(orgId, input.name, id)
  const row = await prisma.iCPProfile.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description ?? undefined,
      criteria: normalizeCriteria(input) as object,
    },
  })
  return toView(row)
}

export async function deleteICP(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.iCPProfile.deleteMany({ where: { id, { organizationId: orgId } } })
  return result.count > 0
}

export async function activateICP(orgId: string, id: string): Promise<ICPView | null> {
  const target = await getICP(orgId, id)
  if (!target) return null
  await prisma.$transaction([
    prisma.iCPProfile.updateMany({ where: { { organizationId: orgId }, isActive: true }, data: { isActive: false } }),
    prisma.iCPProfile.update({ where: { id }, data: { isActive: true } }),
  ])
  return { ...target, isActive: true }
}

export async function deactivateICP(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.iCPProfile.updateMany({ where: { id, { organizationId: orgId } }, data: { isActive: false } })
  return result.count > 0
}

export async function duplicateICP(orgId: string, id: string): Promise<ICPView | null> {
  const source = await getICP(orgId, id)
  if (!source) return null
  const base = `${source.name} Copy`
  let name = base
  for (let i = 2; i <= 10 && (await prisma.iCPProfile.findFirst({ where: { { organizationId: orgId }, name } })); i++) {
    name = `${base} ${i}`
  }
  const row = await prisma.iCPProfile.create({
    data: {
      organizationId: orgId,
      name,
      description: source.description,
      criteria: source.criteria as object,
      isActive: false,
    },
  })
  return toView(row)
}