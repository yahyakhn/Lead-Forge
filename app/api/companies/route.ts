import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { companySchema } from "@/lib/crm/validators"
import { createCompany, listCompanies } from "@/lib/crm/companies"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const companyList = await listCompanies(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    search: sp.search,
  })
  return NextResponse.json(companyList)
})

export const POST = withOrg(async ({ orgId }, request) => {
  const input = await parseJson(companySchema, request)
  const company = await createCompany(orgId, input)
  return NextResponse.json(company, { status: 201 })
})