import { requireSession } from "@/lib/auth"
import { listStages } from "@/lib/crm/pipeline"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/crm/page-header"
import { ErrorState } from "@/components/crm/states"
import { PipelineBoard, type BoardLead } from "@/components/crm/pipeline-board"
import type { LeadStatus } from "@/generated/prisma/client"

export default async function PipelinePage() {
  const session = await requireSession()
  const orgId = session.organization.id

  let stages
  try {
    stages = await listStages(orgId)
  } catch {
    return <ErrorState message="We couldn't load your pipeline." />
  }

  const boards: { id: string; name: string; slug: string; color: string | null; leads: BoardLead[] }[] = []

  try {
    for (const stage of stages) {
      const leads = await prisma.lead.findMany({
        where: { { organizationId: orgId }, status: stage.slug.toUpperCase() as LeadStatus },
        select: {
          id: true,
          score: true,
          priority: true,
          company: { select: { name: true, domain: true } },
          contact: { select: { fullName: true } },
          owner: { select: { name: true } },
        },
        orderBy: [{ score: "desc" }, { createdAt: "desc" }],
        take: 200,
      })
      boards.push({
        id: stage.id,
        name: stage.name,
        slug: stage.slug,
        color: stage.color,
        leads: leads.map((l) => ({
          id: l.id,
          companyName: l.company?.name ?? null,
          companyDomain: l.company?.domain ?? null,
          contactName: l.contact?.fullName ?? null,
          score: l.score,
          priority: l.priority,
          ownerName: l.owner?.name ?? null,
        })),
      })
    }
  } catch {
    return <ErrorState message="We couldn't load your pipeline." />
  }

  return (
    <div>
      <PageHeader title="Pipeline" description="Move leads between stages. Stage changes are logged as activity." />
      <PipelineBoard
        stages={boards}
        leadsByStatus={Object.fromEntries(boards.map((b) => [b.slug.toUpperCase(), b.leads]))}
      />
    </div>
  )
}