import { NextResponse } from "next/server"
import type { z } from "zod"
import { getSession, type SessionData } from "@/lib/auth"

interface HandlerContext<T> {
  orgId: string
  session: SessionData
  ctx: T
}

export function withOrg<T>(
  handler: (context: HandlerContext<T>, request: Request) => Promise<Response>,
) {
  return async (request: Request, routeCtx: T) => {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    try {
      return await handler(
        { orgId: session.organization.id, session, ctx: routeCtx },
        request,
      )
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Bad request" },
        { status: 400 },
      )
    }
  }
}

export async function parseJson<T>(schema: z.ZodType<T>, request: Request): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input")
  }
  return parsed.data
}

export function parseSearchParams(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams)
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}