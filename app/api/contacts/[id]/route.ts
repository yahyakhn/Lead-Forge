import { NextResponse } from "next/server"
import { withOrg, parseJson, notFound } from "@/lib/crm/http"
import { contactSchema } from "@/lib/crm/validators"
import { deleteContact, getContact, updateContact } from "@/lib/crm/contacts"

export const GET = withOrg<RouteContext<"/api/contacts/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  const contact = await getContact(orgId, id)
  return contact ? NextResponse.json(contact) : notFound()
})

export const PATCH = withOrg<RouteContext<"/api/contacts/[id]">>(async ({ orgId, ctx }, request) => {
  const { id } = await ctx.params
  const input = await parseJson(contactSchema.partial(), request)
  const contact = await updateContact(orgId, id, input)
  return contact ? NextResponse.json(contact) : notFound()
})

export const DELETE = withOrg<RouteContext<"/api/contacts/[id]">>(async ({ orgId, ctx }) => {
  const { id } = await ctx.params
  return (await deleteContact(orgId, id))
    ? NextResponse.json({ ok: true })
    : notFound()
})