import { NextResponse } from "next/server"
import { withOrg, parseJson, notFound } from "@/lib/crm/http"
import { dealSchema } from "@/lib/crm/validators"
import { deleteDeal, getDeal, updateDeal } from "@/lib/crm/deals"

export const GET = withOrg<RouteContext<"/api/deals/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  const deal = await getDeal(orgId, id)
  return deal ? NextResponse.json(deal) : notFound()
})

export const PATCH = withOrg<RouteContext<"/api/deals/[id]">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const input = await parseJson(dealSchema.partial(), request)
  const deal = await updateDeal(orgId, id, input)
  return deal ? NextResponse.json(deal) : notFound()
})

export const DELETE = withOrg<RouteContext<"/api/deals/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  return (await deleteDeal(orgId, id))
    ? NextResponse.json({ ok: true })
    : notFound()
})