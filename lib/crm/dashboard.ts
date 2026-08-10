import { prisma } from "@/lib/db"
import { orgWhere } from "@/lib/crm/scope"
import { listStages } from "@/lib/crm/pipeline"
import type { LeadStatus } from "@/generated/prisma/client"

export async function getOrganizationStats(orgId: string) {
  const [totalLeads, qualifiedLeads, highPriorityLeads, totalCompanies, totalContacts, openDeals, recentLeads, stages] =
    await Promise.all([
      prisma.lead.count({ where: orgWhere(orgId) }),
      prisma.lead.count({ where: { ...orgWhere(orgId), status: "QUALIFIED" } }),
      prisma.lead.count({ where: { ...orgWhere(orgId), priority: "HIGH" } }),
      prisma.company.count({ where: orgWhere(orgId) }),
      prisma.contact.count({ where: orgWhere(orgId) }),
      prisma.deal.count({ where: { ...orgWhere(orgId), stage: { isClosed: false } } }),
      prisma.lead.findMany({
        where: orgWhere(orgId),
        include: {
          company: { select: { id: true, name: true } },
          contact: { select: { id: true, fullName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      listStages(orgId),
    ])

  const pipelineSummary = await Promise.all(
    stages.map(async (stage) => {
      const status = stage.slug.toUpperCase() as LeadStatus
      const count = await prisma.lead.count({ where: { ...orgWhere(orgId), status } })
      return { stage, count }
    }),
  )

  return {
    totalLeads,
    qualifiedLeads,
    highPriorityLeads,
    totalCompanies,
    totalContacts,
    openDeals,
    recentLeads,
    pipelineSummary,
  }
}