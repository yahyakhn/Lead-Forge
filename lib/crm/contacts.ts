import { prisma } from "@/lib/db"
import { buildFullName } from "@/lib/crm/normalize"
import type { ContactInput } from "@/lib/crm/validators"
import { parsePagination } from "@/lib/crm/pagination"
import type { Prisma } from "@/generated/prisma/client"
import type { ContactVerificationStatus } from "@/generated/prisma/client"

const CONTACT_INCLUDE = {
  company: { select: { id: true, name: true } },
} as const

export async function createContact(orgId: string, input: ContactInput) {
  await requireCompany(orgId, input.companyId)
  return prisma.contact.create({ data: toData(orgId, input) })
}

export async function getContact(orgId: string, id: string) {
  return prisma.contact.findFirst({
    where: { id, { organizationId: orgId } },
    include: CONTACT_INCLUDE,
  })
}

export interface ContactFilters {
  page?: number
  pageSize?: number
  search?: string
  companyId?: string
  verificationStatus?: string
}

export async function listContacts(orgId: string, filters: ContactFilters) {
  const { page, pageSize } = parsePagination(filters)
  const search = filters.search?.trim()
  const where: Prisma.ContactWhereInput = {
    { organizationId: orgId },
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.verificationStatus
      ? { verificationStatus: filters.verificationStatus as ContactVerificationStatus }
      : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { email: { contains: search.toLowerCase() } },
          ],
        }
      : {}),
  }
  const [total, data] = await Promise.all([
    prisma.contact.count({ where }),
    prisma.contact.findMany({ where, include: CONTACT_INCLUDE, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { data, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

export async function updateContact(orgId: string, id: string, input: Partial<ContactInput>) {
  const existing = await getContact(orgId, id)
  if (!existing) return null
  await requireCompany(orgId, input.companyId)
  const firstName = input.firstName ?? existing.firstName
  const lastName = input.lastName ?? existing.lastName ?? undefined
  return prisma.contact.update({
    where: { id },
    data: {
      ...input,
      ...(input.firstName !== undefined || input.lastName !== undefined
        ? { fullName: buildFullName(firstName, lastName) }
        : {}),
    },
  })
}

export async function deleteContact(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.contact.deleteMany({ where: { id, { organizationId: orgId } } })
  return result.count > 0
}

async function requireCompany(orgId: string, companyId?: string) {
  if (!companyId) return
  const company = await prisma.company.findFirst({ where: { id: companyId, { organizationId: orgId } } })
  if (!company) throw new Error("Company does not exist in this organization")
}

function toData(orgId: string, input: ContactInput): Prisma.ContactUncheckedCreateInput {
  const { firstName, lastName, ...rest } = input
  return {
    ...rest,
    firstName,
    lastName: lastName ?? undefined,
    fullName: buildFullName(firstName, lastName ?? ""),
    organizationId: orgId,
  }
}