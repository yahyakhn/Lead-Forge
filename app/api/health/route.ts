import { checkDatabase } from "@/lib/health"

export async function GET() {
  const ok = await checkDatabase()
  return Response.json(
    { status: ok ? "ok" : "degraded" },
    { status: ok ? 200 : 503 },
  )
}
