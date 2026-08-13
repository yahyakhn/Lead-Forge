"use server"

// TASK 014: email discovery/verification server actions. Kept in a separate
// module from lib/actions.ts to avoid cross-task churn; same conventions
// (FormData in, requireSession org-scoping, revalidatePath).

import { revalidatePath } from "next/cache"
import { requireSession } from "@/lib/auth"
import {
  markEmailInvalid,
  removeEmail,
  requestEmailDiscovery,
  requestEmailVerification,
  resolveEmailConflict,
  setPrimaryEmail,
  updateSettings,
} from "@/lib/lead-engine/email/service"
import { EmailConflictResolution } from "@/generated/prisma/enums"

type Actor = { id: string; name: string }

async function actor(): Promise<Actor> {
  const session = await requireSession()
  return { id: session.user.id, name: session.user.name }
}

export async function findEmailAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string | null
  const candidateId = formData.get("candidateId") as string | null
  const force = formData.get("force") === "true"
  const result = await requestEmailDiscovery(
    session.organization.id,
    act,
    { leadId: leadId ?? undefined, candidateId: candidateId ?? undefined, force },
  )
  if (!result.ok && result.error) throw new Error(result.error)
  if (candidateId) revalidatePath("/lead-engine/candidates/[id]")
  if (leadId) revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/email/discovery")
}

export async function verifyEmailAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const emailId = formData.get("emailId") as string
  const force = formData.get("force") === "true"
  const result = await requestEmailVerification(session.organization.id, act, emailId, { force })
  if (!result.ok && result.error) throw new Error(result.error)
  revalidatePath("/lead-engine/email/verification")
  revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/candidates/[id]")
}

export async function setPrimaryEmailAction(formData: FormData) {
  const session = await requireSession()
  const emailId = formData.get("emailId") as string
  const result = await setPrimaryEmail(session.organization.id, emailId, await actor())
  if (!result.ok) throw new Error(result.error)
  revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/candidates/[id]")
}

export async function markEmailInvalidAction(formData: FormData) {
  const session = await requireSession()
  const emailId = formData.get("emailId") as string
  const result = await markEmailInvalid(session.organization.id, emailId, await actor())
  if (!result.ok) throw new Error(result.error)
  revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/candidates/[id]")
}

export async function removeEmailAction(formData: FormData) {
  const session = await requireSession()
  const emailId = formData.get("emailId") as string
  const result = await removeEmail(session.organization.id, emailId, await actor())
  if (!result.ok) throw new Error(result.error)
  revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/candidates/[id]")
}

export async function resolveEmailConflictAction(formData: FormData) {
  const session = await requireSession()
  const conflictId = formData.get("conflictId") as string
  const resolution = formData.get("resolution") as EmailConflictResolution
  const result = await resolveEmailConflict(session.organization.id, conflictId, resolution, await actor())
  if (!result.ok) throw new Error(result.error)
  revalidatePath("/leads/[id]")
  revalidatePath("/lead-engine/candidates/[id]")
}

export async function updateEmailSettingsAction(formData: FormData) {
  const session = await requireSession()
  if (session.user.role !== "ADMIN") throw new Error("Only admins can manage email settings")
  const num = (key: string, fallback: number | null = null): number | null => {
    const raw = formData.get(key)
    return raw === null || raw === "" ? fallback : Number(raw)
  }
  const list = (key: string) => {
    const raw = (formData.get(key) as string | null) ?? ""
    return raw.split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean)
  }
  await updateSettings(
    session.organization.id,
    {
      discoveryEnabled: formData.get("discoveryEnabled") === "on",
      verificationEnabled: formData.get("verificationEnabled") === "on",
      enrichmentFallback: formData.get("enrichmentFallback") === "on",
      verificationCacheDays: num("verificationCacheDays", 14) ?? 14,
      discoveryFreshnessDays: num("discoveryFreshnessDays", 14) ?? 14,
      batchMaxEmails: num("batchMaxEmails", 100) ?? 100,
      discoveryRateLimit: num("discoveryRateLimit", 60) ?? 60,
      verificationRateLimit: num("verificationRateLimit", 120) ?? 120,
      genericDomains: list("genericDomains"),
      rolePrefixes: list("rolePrefixes"),
      disposableDomains: list("disposableDomains"),
    },
    await actor(),
  )
  revalidatePath("/settings/email")
}
