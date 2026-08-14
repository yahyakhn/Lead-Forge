import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { processProviderWebhook, webhookSignatureValid } from "@/lib/lead-engine/outreach/service"
import { enqueueSequenceScan } from "@/lib/lead-engine/job-queue"

// TASK 015 §56-§58: inbound provider webhook endpoint. Signature-gated with a
// shared secret from env (PROVIDER_WEBHOOK_SECRET); disabled when unset.
// Webhook events are idempotent via providerEventId (§58). Only events the
// provider actually supports are accepted (§56).

export const runtime = "nodejs"

export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const secret = process.env.PROVIDER_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: "Webhooks are not enabled" }, { status: 404 })
  const { provider } = await params
  const body = await _req.json()
  const signature = _req.headers.get("x-webhook-secret") ?? ""
  if (!webhookSignatureValid(secret, signature)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })
  }

  const orgId = typeof body.organizationId === "string" ? body.organizationId : null
  if (orgId) {
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) return NextResponse.json({ ok: false, error: "Unknown organization" }, { status: 404 })
  }

  const result = await processProviderWebhook(orgId!, provider, body)
  if (result.ok && orgId) enqueueSequenceScan(orgId) // §28-§31: reply/bounce/unsubscribe auto-stop is re-checked at the next step
  return NextResponse.json(result, { status: result.ok ? 200 : 400 })
}