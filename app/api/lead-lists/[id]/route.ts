import { NextResponse } from "next/server"
import { withOrg, parseJson, notFound } from "@/lib/crm/http"
import { leadListSchema } from "@/lib/crm/validators"
import { deleteLeadList, getLeadList, updateLeadList } from "@/lib/crm/lead-lists"

export const GET = withOrg<RouteContext<"/api/lead-lists/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  const list = await getLeadList(orgId, id)
  return list ? NextResponse.json(list) : notFound()
})

export const PATCH = withOrg<RouteContext<"/api/lead-lists/[id]">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const input = await parseJson(leadListSchema.partial(), request)
  const list = await updateLeadList(orgId, id, input)
  return list ? NextResponse.json(list) : notFound()
})

export const DELETE = withOrg<RouteContext<"/api/lead-lists/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  return (await deleteLeadList(orgId, id))
    ? NextResponse.json({ ok: true })
    : notFound()
})