import { prisma } from "@/lib/db"
import { PrismaClient } from "@/generated/prisma/client"
import type { LeadStatus } from "@/generated/prisma/client"
import { updateLead } from "@/lib/crm/leads"

const LEAD_STATUSES: readonly string[] = [
  "NEW",
  "REVIEW",
  "QUALIFIED",
  "DISQUALIFIED",
  "CONTACTED",
  "ENGAGED",
  "OPPORTUNITY",
  "CONVERTED",
  "LOST",
]

export interface PipelineStageSpec {
  name: string
  slug: string
  position: number
  color: string
  isClosed: boolean
  isWon: boolean
}

export const DEFAULT_PIPELINE_STAGES: PipelineStageSpec[] = [
  { name: "NEW", slug: "new", position: 1, color: "#64748b", isClosed: false, isWon: false },
  { name: "QUALIFIED", slug: "qualified", position: 2, color: "#3b82f6", isClosed: false, isWon: false },
  { name: "CONTACTED", slug: "contacted", position: 3, color: "#0ea5e9", isClosed: false, isWon: false },
  { name: "REPLIED", slug: "replied", position: 4, color: "#06b6d4", isClosed: false, isWon: false },
  { name: "MEETING", slug: "meeting", position: 5, color: "#10b981", isClosed: false, isWon: false },
  { name: "PROPOSAL", slug: "proposal", position: 6, color: "#f59e0b", isClosed: false, isWon: false },
  { name: "WON", slug: "won", position: 7, color: "#22c55e", isClosed: true, isWon: true },
  { name: "LOST", slug: "lost", position: 8, color: "#ef4444", isClosed: true, isWon: false },
]

export async function createDefaultPipelineStages(
  prisma: PrismaClient,
  orgId: string,
): Promise<void> {
  await prisma.pipelineStage.createMany({
    data: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, organizationId: orgId })),
  })
}

export async function listStages(orgId: string) {
  return prisma.pipelineStage.findMany({
    where: { organizationId: orgId },
    orderBy: { position: "asc" },
  })
}

export async function moveLeadToStage(orgId: string, leadId: string, stageId: string, userId?: string) {
  const [stage, lead] = await Promise.all([
    prisma.pipelineStage.findFirst({ where: { id: stageId, organizationId: orgId } }),
    prisma.lead.findFirst({ where: { id: leadId, organizationId: orgId } }),
  ])
  if (!stage) throw new Error("Pipeline stage does not exist in this organization")
  if (!lead) throw new Error("Lead does not exist in this organization")
  const status = stage.slug.toUpperCase()
  if (!LEAD_STATUSES.includes(status)) throw new Error(`Stage ${stage.name} has no matching lead status`)
  return updateLead(orgId, leadId, { status: status as LeadStatus }, userId)
}

// ponytail: leads are status-driven, not stage-linked; stages map 1:1 to LeadStatus enums via slug