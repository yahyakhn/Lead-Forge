import { NextResponse } from "next/server"
import { withOrg, parseJson } from "@/lib/crm/http"
import { z } from "zod"
import { addLeadToList } from "@/lib/crm/lead-lists"

const addLeadSchema = z.object({ leadId: z.string().min(1) })

export const POST = withOrg<RouteContext<"/api/lead-lists/[id]/leads">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const { leadId } = await parseJson(addLeadSchema, request)
  await addLeadToList(orgId, id, leadId)
  return NextResponse.json({ ok: true }, { status: 201 })
})