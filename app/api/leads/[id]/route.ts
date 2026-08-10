import { NextResponse } from "next/server"
import { withOrg, parseJson, notFound } from "@/lib/crm/http"
import { leadSchema } from "@/lib/crm/validators"
import { deleteLead, getLead, updateLead } from "@/lib/crm/leads"

export const GET = withOrg<RouteContext<"/api/leads/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  const lead = await getLead(orgId, id)
  return lead ? NextResponse.json(lead) : notFound()
})

export const PATCH = withOrg<RouteContext<"/api/leads/[id]">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const input = await parseJson(leadSchema.partial(), request)
  const lead = await updateLead(orgId, id, input)
  return lead ? NextResponse.json(lead) : notFound()
})

export const DELETE = withOrg<RouteContext<"/api/leads/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  return (await deleteLead(orgId, id))
    ? NextResponse.json({ ok: true })
    : notFound()
})