import { prisma } from "@/lib/db"
import { normalizeCompanyName, normalizeDomain } from "@/lib/crm/normalize"
import type { CompanyInput } from "@/lib/crm/validators"
import { parsePagination, type PageResult } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"
import type { CompanyStatus } from "@/generated/prisma/client"

export async function createCompany(orgId: string, input: CompanyInput) {
  return prisma.company.create({ data: toData(orgId, input) })
}

export async function getCompany(orgId: string, id: string) {
  return prisma.company.findFirst({ where: { id, { organizationId: orgId } } })
}

const COMPANY_LIST_INCLUDE = { _count: { select: { contacts: true, leads: true } } } satisfies Prisma.CompanyInclude

export type CompanyListItem = Prisma.CompanyGetPayload<{ include: typeof COMPANY_LIST_INCLUDE }>

export interface CompanyFilters {
  page?: number
  pageSize?: number
  search?: string
  status?: string
}

export async function listCompanies(orgId: string, filters: CompanyFilters): Promise<PageResult<CompanyListItem>> {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.CompanyWhereInput = {
    { organizationId: orgId },
    ...(filters.status ? { status: filters.status as CompanyStatus } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { normalizedName: { contains: search.toLowerCase() } },
            { domain: { contains: search.toLowerCase() } },
          ],
        }
      : {}),
  }
  const [total, data] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      include: COMPANY_LIST_INCLUDE,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateCompany(orgId: string, id: string, input: Partial<CompanyInput>) {
  if (!(await getCompany(orgId, id))) return null
  return prisma.company.update({
    where: { id },
    data: toUpdateData(input),
  })
}

export async function deleteCompany(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.company.deleteMany({ where: { id, { organizationId: orgId } } })
  return result.count > 0
}

function toData(orgId: string, input: CompanyInput): Prisma.CompanyUncheckedCreateInput {
  const { domain, website, name, ...rest } = input
  return {
    ...rest,
    website: website ?? undefined,
    name,
    normalizedName: normalizeCompanyName(name),
    domain: domain ? normalizeDomain(domain) : null,
    organizationId: orgId,
  }
}

function toUpdateData(input: Partial<CompanyInput>): Prisma.CompanyUncheckedUpdateInput {
  const { domain, website, name, ...rest } = input
  return {
    ...rest,
    ...(website !== undefined ? { website: website ?? undefined } : {}),
    ...(name !== undefined ? { name, normalizedName: normalizeCompanyName(name) } : {}),
    ...(domain !== undefined ? { domain: domain ? normalizeDomain(domain) : null } : {}),
  }
}