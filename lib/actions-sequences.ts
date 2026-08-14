"use server"

// TASK 016: outreach sequence server actions. Same conventions as the rest
// of the app: requireSession org-scoping, FormData in, throw on error,
// revalidatePath. Permission checks (admin-only writes) live in the service
// layer — these actions never bypass them (§79).

import { revalidatePath } from "next/cache"
import { requireSession } from "@/lib/auth"
import {
  createSequence,
  updateSequence,
  duplicateSequence,
  setSequenceStatus,
  enrollLead,
  bulkEnroll,
  pauseEnrollment,
  resumeEnrollment,
  stopEnrollment,
  completeSequenceTask,
  type StepInput,
} from "@/lib/lead-engine/sequences/service"
import { enqueueSequenceScan } from "@/lib/lead-engine/job-queue"

async function revalidateSequences() {
  revalidatePath("/sequences")
  revalidatePath("/sales")
  revalidatePath("/dashboard")
}

function stepsFrom(formData: FormData): StepInput[] {
  const raw = formData.get("steps")
  if (typeof raw !== "string" || !raw.trim()) return []
  return JSON.parse(raw) as StepInput[]
}

export async function createSequenceAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  const sequence = await createSequence(session.organization.id, act, {
    name: (formData.get("name") as string) ?? "",
    description: (formData.get("description") as string | null) ?? null,
    maxDailyEmails: formData.get("maxDailyEmails") ? Number(formData.get("maxDailyEmails")) : null,
  })
  await updateSequence(session.organization.id, act, sequence.id, { steps: stepsFrom(formData) })
  revalidateSequences()
}

export async function updateSequenceAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await updateSequence(session.organization.id, act, formData.get("id") as string, {
    name: (formData.get("name") as string | null) ?? undefined,
    description: (formData.get("description") as string | null) ?? undefined,
    maxDailyEmails: formData.get("maxDailyEmails") ? Number(formData.get("maxDailyEmails")) : undefined,
    steps: stepsFrom(formData),
  })
  revalidateSequences()
}

export async function duplicateSequenceAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await duplicateSequence(session.organization.id, act, formData.get("id") as string)
  revalidateSequences()
}

export async function setSequenceStatusAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await setSequenceStatus(session.organization.id, act, formData.get("id") as string, formData.get("status") as "ACTIVE" | "PAUSED" | "ARCHIVED")
  revalidateSequences()
}

export async function enrollLeadAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  const result = await enrollLead(session.organization.id, act, {
    sequenceId: formData.get("sequenceId") as string,
    leadId: formData.get("leadId") as string,
    emailId: (formData.get("emailId") as string | null) ?? null,
  })
  if (!result.ok) throw new Error(result.error)
  enqueueSequenceScan(session.organization.id)
  revalidateSequences()
}

export async function bulkEnrollAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  const leadIds = JSON.parse((formData.get("leadIds") as string) ?? "[]") as string[]
  await bulkEnroll(session.organization.id, act, { sequenceId: formData.get("sequenceId") as string, leadIds })
  enqueueSequenceScan(session.organization.id)
  revalidateSequences()
}

export async function pauseEnrollmentAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await pauseEnrollment(session.organization.id, act, formData.get("enrollmentId") as string)
  revalidateSequences()
}

export async function resumeEnrollmentAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await resumeEnrollment(session.organization.id, act, formData.get("enrollmentId") as string)
  revalidateSequences()
}

export async function stopEnrollmentAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await stopEnrollment(session.organization.id, act, formData.get("enrollmentId") as string)
  revalidateSequences()
}

export async function completeSequenceTaskAction(formData: FormData) {
  const session = await requireSession()
  const act = { id: session.user.id, name: session.user.name, role: session.user.role }
  await completeSequenceTask(session.organization.id, act, formData.get("taskId") as string)
  enqueueSequenceScan(session.organization.id)
  revalidateSequences()
}
