import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createSession, hashPassword } from "@/lib/auth"
import { registerSchema } from "@/lib/validators"
import { createDefaultPipelineStages } from "@/lib/crm/pipeline"

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(
    await request.json().catch(() => null),
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    )
  }
  const { name, email, password, organizationName } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json(
      { error: "Email already registered" },
      { status: 409 },
    )
  }

  const user = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: organizationName },
    })
    await createDefaultPipelineStages(organization.id)
    return tx.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        organizationId: organization.id,
      },
    })
  })

  await createSession(user.id, user.organizationId)
  return NextResponse.json({
    ok: true,
    user: { name: user.name, email: user.email },
  })
}