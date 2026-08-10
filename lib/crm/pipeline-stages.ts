import { prisma } from "@/lib/db"
import type { PipelineStageInput } from "@/lib/crm/validators"

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

export async function createStage(orgId: string, input: PipelineStageInput) {
  const slug = input.slug ?? slugify(input.name)
  const position =
    input.position ??
    (await prisma.pipelineStage.count({ where: { organizationId: orgId } })) + 1
  try {
    return await prisma.pipelineStage.create({
      data: {
        name: input.name,
        slug,
        position,
        color: input.color,
        isClosed: input.isClosed ?? false,
        isWon: input.isWon ?? false,
        organizationId: orgId,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      throw new Error(`A stage with slug "${slug}" already exists`)
    }
    throw error
  }
}

export async function updateStage(orgId: string, id: string, input: Partial<PipelineStageInput>) {
  const existing = await prisma.pipelineStage.findFirst({ where: { id, { organizationId: orgId } } })
  if (!existing) return null
  const { ...data } = input
  if (input.slug === "" || input.slug === undefined) delete data.slug
  return prisma.pipelineStage.update({ where: { id }, data })
}

export async function deleteStage(orgId: string, id: string) {
  try {
    const result = await prisma.pipelineStage.deleteMany({ where: { id, { organizationId: orgId } } })
    return result.count > 0
  } catch {
    throw new Error("Stage cannot be deleted while deals reference it")
  }
}