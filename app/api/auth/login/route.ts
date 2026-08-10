import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createSession, verifyPassword } from "@/lib/auth"
import { loginSchema } from "@/lib/validators"

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    )
  }
  const { email, password } = parsed.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 },
    )
  }

  await createSession(user.id, user.organizationId)
  return NextResponse.json({ ok: true })
}
