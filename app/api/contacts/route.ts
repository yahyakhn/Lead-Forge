import { NextResponse } from "next/server"
import { withOrg, parseJson, parseSearchParams } from "@/lib/crm/http"
import { contactSchema } from "@/lib/crm/validators"
import { createContact, listContacts } from "@/lib/crm/contacts"

export const GET = withOrg(async ({ orgId }, request) => {
  const sp = parseSearchParams(request)
  const contactList = await listContacts(orgId, {
    page: Number(sp.page),
    pageSize: Number(sp.pageSize),
    search: sp.search,
    companyId: sp.companyId,
  })
  return NextResponse.json(contactList)
})

export const POST = withOrg(async ({ orgId }, request) => {
  const input = await parseJson(contactSchema, request)
  const contact = await createContact(orgId, input)
  return NextResponse.json(contact, { status: 201 })
})