import { NextResponse } from "next/server"
import { withOrg, parseJson, notFound } from "@/lib/crm/http"
import { companySchema } from "@/lib/crm/validators"
import { deleteCompany, getCompany, updateCompany } from "@/lib/crm/companies"

export const GET = withOrg<RouteContext<"/api/companies/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  const company = await getCompany(orgId, id)
  return company ? NextResponse.json(company) : notFound()
})

export const PATCH = withOrg<RouteContext<"/api/companies/[id]">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const input = await parseJson(companySchema.partial(), request)
  const company = await updateCompany(orgId, id, input)
  return company ? NextResponse.json(company) : notFound()
})

export const DELETE = withOrg<RouteContext<"/api/companies/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  return (await deleteCompany(orgId, id))
    ? NextResponse.json({ ok: true })
    : notFound()
})