import { NextResponse } from "next/server"
import { withOrg, notFound } from "@/lib/crm/http"
import { removeLeadFromList } from "@/lib/crm/lead-lists"

export const DELETE = withOrg<RouteContext<"/api/lead-lists/[id]/leads/[leadId]">>(async ({ orgId, ctx }) => {
  const { id, leadId } = await ctx.params
  return (await removeLeadFromList(orgId, id, leadId))
    ? NextResponse.json({ ok: true })
    : notFound()
})