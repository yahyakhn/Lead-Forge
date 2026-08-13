"use server"

// TASK 015: sales outreach server actions. Same conventions as the rest of
// the app: requireSession org-scoping, FormData in, throw on error,
// revalidatePath. Compliance protections are enforced in the service layer —
// these actions never disable them (§90).

import { revalidatePath } from "next/cache"
import { requireSession } from "@/lib/auth"
import {
  addNote,
  archiveEmailTemplate,
  createEmailAccount,
  createEmailTemplate,
  deleteDraft,
  duplicateEmailTemplate,
  listEmailAccounts,
  logCall,
  saveDraft,
  sendEmail,
  setDefaultEmailAccount,
  updateEmailAccountStatus,
  updateEmailTemplate,
  updateOutreach,
  type Actor,
} from "@/lib/lead-engine/outreach/service"
import { updateSettings } from "@/lib/lead-engine/email/service"
import { CallOutcome, EmailAccountStatus, EmailTemplateCategory, OutreachStatus } from "@/generated/prisma/enums"

async function actor(): Promise<Actor> {
  const session = await requireSession()
  return { id: session.user.id, name: session.user.name, role: session.user.role }
}

async function revalidate(leadId: string) {
  revalidatePath("/sales")
  revalidatePath(`/sales/leads/${leadId}`)
  revalidatePath(`/leads/${leadId}`)
}

export async function sendEmailAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  const result = await sendEmail(session.organization.id, act, {
    leadId,
    emailId: formData.get("emailId") as string,
    cc: (formData.get("cc") as string | null) ?? undefined,
    bcc: (formData.get("bcc") as string | null) ?? undefined,
    subject: (formData.get("subject") as string) ?? "",
    body: (formData.get("body") as string) ?? "",
    templateId: (formData.get("templateId") as string | null) ?? null,
    accountId: (formData.get("accountId") as string | null) ?? null,
    confirmCooldown: formData.get("confirmCooldown") === "true",
  })
  if (!result.ok) throw new Error(result.error)
  revalidate(leadId)
  revalidatePath("/dashboard")
}

export async function saveDraftAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  await saveDraft(session.organization.id, act, {
    leadId,
    draftId: (formData.get("draftId") as string | null) ?? undefined,
    emailId: (formData.get("emailId") as string | null) ?? null,
    cc: (formData.get("cc") as string | null) ?? null,
    bcc: (formData.get("bcc") as string | null) ?? null,
    subject: (formData.get("subject") as string) ?? "",
    body: (formData.get("body") as string) ?? "",
    templateId: (formData.get("templateId") as string | null) ?? null,
  })
  revalidate(leadId)
}

export async function deleteDraftAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  await deleteDraft(session.organization.id, act, formData.get("draftId") as string)
  revalidate(leadId)
}

export async function logCallAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  const durationRaw = formData.get("durationMin") as string | null
  await logCall(session.organization.id, act, {
    leadId,
    contactId: (formData.get("contactId") as string | null) ?? null,
    durationMin: durationRaw ? Number(durationRaw) : null,
    outcome: (formData.get("outcome") as CallOutcome) ?? CallOutcome.CONNECTED,
    notes: (formData.get("notes") as string | null) ?? undefined,
  })
  revalidate(leadId)
  revalidatePath("/dashboard")
}

export async function addNoteAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  await addNote(session.organization.id, act, {
    leadId,
    contactId: (formData.get("contactId") as string | null) ?? null,
    body: (formData.get("body") as string) ?? "",
  })
  revalidate(leadId)
}

export async function updateOutreachAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const leadId = formData.get("leadId") as string
  const statusRaw = formData.get("outreachStatus") as string | null
  const nextActionRaw = formData.get("nextAction") as string | null
  const nextActionAtRaw = formData.get("nextActionAt") as string | null
  await updateOutreach(session.organization.id, act, {
    leadId,
    outreachStatus: statusRaw ? (statusRaw as OutreachStatus) : undefined,
    nextAction: nextActionRaw ?? undefined,
    nextActionAt: nextActionAtRaw ? new Date(nextActionAtRaw) : undefined,
  })
  revalidate(leadId)
  revalidatePath("/sales")
}

// ── template management (§36) ─────────────────────────────────────────────

export async function createTemplateAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  await createEmailTemplate(session.organization.id, act, {
    name: (formData.get("name") as string) ?? "",
    description: (formData.get("description") as string | null) ?? undefined,
    category: (formData.get("category") as EmailTemplateCategory) ?? EmailTemplateCategory.GENERAL,
    subject: (formData.get("subject") as string) ?? "",
    body: (formData.get("body") as string) ?? "",
  })
  revalidatePath("/settings/email-templates")
}

export async function updateTemplateAction(formData: FormData) {
  const session = await requireSession()
  const id = formData.get("id") as string
  await updateEmailTemplate(session.organization.id, id, {
    name: (formData.get("name") as string) ?? undefined,
    description: (formData.get("description") as string | null) ?? undefined,
    category: (formData.get("category") as EmailTemplateCategory) ?? undefined,
    subject: (formData.get("subject") as string) ?? undefined,
    body: (formData.get("body") as string) ?? undefined,
  })
  revalidatePath("/settings/email-templates")
}

export async function duplicateTemplateAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  await duplicateEmailTemplate(session.organization.id, act, formData.get("id") as string)
  revalidatePath("/settings/email-templates")
}

export async function archiveTemplateAction(formData: FormData) {
  const session = await requireSession()
  await archiveEmailTemplate(session.organization.id, formData.get("id") as string)
  revalidatePath("/settings/email-templates")
}

// ── accounts (§18, §64-§66) — admin only ──────────────────────────────────

export async function createEmailAccountAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  await createEmailAccount(session.organization.id, act, {
    name: (formData.get("name") as string) ?? "",
    email: (formData.get("email") as string) ?? "",
    isDefault: formData.get("isDefault") === "on",
  })
  revalidatePath("/settings/email")
}

export async function setDefaultAccountAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  await setDefaultEmailAccount(session.organization.id, act, formData.get("accountId") as string)
  revalidatePath("/settings/email")
}

export async function toggleAccountAction(formData: FormData) {
  const session = await requireSession()
  const act = await actor()
  const enable = formData.get("enable") === "true"
  await updateEmailAccountStatus(session.organization.id, act, formData.get("accountId") as string, enable ? EmailAccountStatus.ACTIVE : EmailAccountStatus.DISABLED)
  revalidatePath("/settings/email")
}

// ── outreach settings (§19, §63, §86) — admin only ────────────────────────

export async function updateOutreachSettingsAction(formData: FormData) {
  const session = await requireSession()
  if (session.user.role !== "ADMIN") throw new Error("Only admins can manage email settings")
  const act = await actor()
  const num = (key: string, fallback: number | null = null): number | null => {
    const raw = formData.get(key)
    return raw === null || raw === "" ? fallback : Number(raw)
  }
  await updateSettings(
    session.organization.id,
    {
      sendingEnabled: formData.get("sendingEnabled") === "on",
      dailySendLimit: num("dailySendLimit", 100) ?? 100,
      hourlySendLimit: num("hourlySendLimit", 30) ?? 30,
      minDaysBetweenOutreach: num("minDaysBetweenOutreach", 3) ?? 3,
      allowSendToUnverified: formData.get("allowSendToUnverified") === "on",
      senderName: (formData.get("senderName") as string | null) ?? undefined,
      senderEmail: (formData.get("senderEmail") as string | null) ?? undefined,
      replyTo: (formData.get("replyTo") as string | null) ?? undefined,
      signature: (formData.get("signature") as string | null) ?? undefined,
    },
    act,
  )
  revalidatePath("/settings/email")
}

export { listEmailAccounts }
