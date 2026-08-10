import { prisma } from "@/lib/db"
import { orgWhere } from "@/lib/crm/scope"

export function listUsers(orgId: string) {
  return prisma.user.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  })
}

export function listCompanyOptions(orgId: string) {
  return prisma.company.findMany({
    where: orgWhere(orgId),
    select: { id: true, name: true, domain: true },
    orderBy: { name: "asc" },
  })
}

export function listContactOptions(orgId: string) {
  return prisma.contact.findMany({
    where: orgWhere(orgId),
    select: { id: true, fullName: true, email: true, companyId: true },
    orderBy: { fullName: "asc" },
  })
}