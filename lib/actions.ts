"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { requireSession, destroySession } from "@/lib/auth"
import {
  companySchema,
  contactSchema,
  leadSchema,
  leadListSchema,
  activitySchema,
  dealSchema,
  icpSchema,
  type CompanyInput,
  type ContactInput,
  type LeadInput,
  type LeadListInput,
  type ActivityInput,
  type DealInput,
  type IcpInput,
} from "@/lib/crm/validators"
import { createCompany, updateCompany, deleteCompany } from "@/lib/crm/companies"
import { createContact, updateContact, deleteContact } from "@/lib/crm/contacts"
import { createLead, updateLead, deleteLead } from "@/lib/crm/leads"
import { createLeadList, deleteLeadList, addLeadToList, removeLeadFromList } from "@/lib/crm/lead-lists"
import { createActivity } from "@/lib/crm/activities"
import { createDeal, updateDeal } from "@/lib/crm/deals"
import { moveLeadToStage } from "@/lib/crm/pipeline"
import {
  createICP,
  updateICP,
  deleteICP,
  activateICP,
  deactivateICP,
  duplicateICP,
} from "@/lib/crm/icp"
import { leadSourceSchema, type LeadSourceInput } from "@/lib/lead-engine/validators"
import {
  createSource,
  updateSource,
  deleteSource,
  activateSource,
  deactivateSource,
} from "@/lib/lead-engine/sources"
import { createRun, cancelRun, getRawPage } from "@/lib/lead-engine/runs"
import { enqueueRun, enqueueExtractionRun } from "@/lib/lead-engine/job-queue"
import { startExtraction } from "@/lib/lead-engine/extraction/service"
import { deduplicateRun } from "@/lib/lead-engine/resolution/service"
import { confirmDuplicateGroup, rejectDuplicateGroup } from "@/lib/lead-engine/resolution/groups"
import { convertCandidate, bulkConvert, bulkPreview, type BulkSummary, type PreviewPlan } from "@/lib/lead-engine/conversion/service"

export type ActionResult = { ok: true; id?: string; redirectTo?: string } | { ok: false; error: string }

async function run<T>(
  schema: z.Schema<T>,
  input: unknown,
  mutate: (orgId: string, userId: string, data: T) => Promise<unknown>,
  revalidate: (data: T) => string[],
): Promise<ActionResult> {
  const session = await requireSession()
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  try {
    const result = await mutate(session.organization.id, session.user.id, parsed.data)
    for (const path of revalidate(parsed.data)) revalidatePath(path)
    return { ok: true, id: typeof result === "object" && result && "id" in result ? String(result.id) : undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

export async function logoutAction() {
  await destroySession()
  redirect("/login")
}

async function mutate(
  fn: (orgId: string, userId: string) => Promise<unknown>,
  paths: string[],
  redirectTo?: string,
): Promise<ActionResult> {
  const session = await requireSession()
  try {
    await fn(session.organization.id, session.user.id)
    for (const path of paths) revalidatePath(path)
    return { ok: true, redirectTo }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

export async function createCompanyAction(input: unknown): Promise<ActionResult> {
  return run(companySchema, input, (orgId, _u, data: CompanyInput) => createCompany(orgId, data), () => ["/companies", "/dashboard"])
}

export async function updateCompanyAction(id: string, input: unknown): Promise<ActionResult> {
  return run(companySchema.partial(), input, (orgId, _u, data: Partial<CompanyInput>) => updateCompany(orgId, id, data), () => [`/companies/${id}`, "/companies", "/dashboard"])
}

export async function deleteCompanyAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteCompany(orgId, id), ["/companies", "/dashboard"], "/companies")
}

export async function createContactAction(input: unknown): Promise<ActionResult> {
  return run(contactSchema, input, (orgId, _u, data: ContactInput) => createContact(orgId, data), () => ["/contacts", "/dashboard", "/companies"])
}

export async function updateContactAction(id: string, input: unknown): Promise<ActionResult> {
  return run(contactSchema.partial(), input, (orgId, _u, data: Partial<ContactInput>) => updateContact(orgId, id, data), () => [`/contacts/${id}`, "/contacts"])
}

export async function deleteContactAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteContact(orgId, id), ["/contacts", "/dashboard"], "/contacts")
}

export async function createLeadAction(input: unknown): Promise<ActionResult> {
  return run(leadSchema, input, (orgId, _u, data: LeadInput) => createLead(orgId, data), () => ["/leads", "/dashboard"])
}

export async function updateLeadAction(id: string, input: unknown): Promise<ActionResult> {
  return run(leadSchema.partial(), input, (orgId, userId, data: Partial<LeadInput>) => updateLead(orgId, id, data, userId), () => [`/leads/${id}`, "/leads", "/pipeline", "/dashboard"])
}

export async function deleteLeadAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteLead(orgId, id), ["/leads", "/pipeline", "/dashboard"], "/leads")
}

export async function createLeadListAction(input: unknown): Promise<ActionResult> {
  return run(leadListSchema, input, (orgId, userId, data: LeadListInput) => createLeadList(orgId, data, userId), () => ["/lead-lists"])
}

export async function deleteLeadListAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteLeadList(orgId, id), ["/lead-lists"], "/lead-lists")
}

export async function addLeadToListAction(listId: string, leadId: string): Promise<ActionResult> {
  return mutate((orgId) => addLeadToList(orgId, listId, leadId), ["/lead-lists", `/lead-lists/${listId}`, `/leads/${leadId}`])
}

export async function removeLeadFromListAction(listId: string, leadId: string): Promise<ActionResult> {
  return mutate((orgId) => removeLeadFromList(orgId, listId, leadId), ["/lead-lists", `/lead-lists/${listId}`, `/leads/${leadId}`])
}

export async function createActivityAction(input: unknown): Promise<ActionResult> {
  return run(
    activitySchema,
    input,
    (orgId, userId, data: ActivityInput) => createActivity(orgId, data, userId),
    (data) => {
      const paths = ["/dashboard", "/pipeline"]
      if (data.leadId) paths.push(`/leads/${data.leadId}`)
      if (data.companyId) paths.push(`/companies/${data.companyId}`)
      if (data.contactId) paths.push(`/contacts/${data.contactId}`)
      return paths
    },
  )
}

export async function createDealAction(input: unknown): Promise<ActionResult> {
  return run(
    dealSchema,
    input,
    (orgId, _u, data: DealInput) => createDeal(orgId, data),
    (data) => (data.leadId ? ["/dashboard", "/pipeline", `/leads/${data.leadId}`] : ["/dashboard", "/pipeline"]),
  )
}

export async function updateDealAction(id: string, input: unknown): Promise<ActionResult> {
  return run(dealSchema.partial(), input, (orgId, _u, data: Partial<DealInput>) => updateDeal(orgId, id, data), () => ["/dashboard", "/pipeline"])
}

export async function moveLeadToStageAction(leadId: string, stageId: string): Promise<ActionResult> {
  return mutate((orgId, userId) => moveLeadToStage(orgId, leadId, stageId, userId), ["/pipeline", "/leads", `/leads/${leadId}`, "/dashboard"])
}

export async function createICPAction(input: unknown): Promise<ActionResult> {
  return run(icpSchema, input, (orgId, userId, data: IcpInput) => createICP(orgId, userId, data), () => ["/icp"])
}

export async function updateICPAction(id: string, input: unknown): Promise<ActionResult> {
  return run(icpSchema, input, (orgId, _u, data: IcpInput) => updateICP(orgId, id, data), () => [`/icp/${id}`, "/icp"])
}

export async function deleteICPAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteICP(orgId, id), ["/icp", "/dashboard"], "/icp")
}

export async function activateICPAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => activateICP(orgId, id), ["/icp", `/icp/${id}`, "/dashboard"])
}

export async function deactivateICPAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deactivateICP(orgId, id), ["/icp", `/icp/${id}`, "/dashboard"])
}

export async function duplicateICPAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => duplicateICP(orgId, id), ["/icp"])
}

export async function createLeadSourceAction(input: unknown): Promise<ActionResult> {
  return run(leadSourceSchema, input, (orgId, userId, data: LeadSourceInput) => createSource(orgId, userId, data), () => ["/scrapers/sources"])
}

export async function updateLeadSourceAction(id: string, input: unknown): Promise<ActionResult> {
  return run(leadSourceSchema.partial(), input, (orgId, _u, data: Partial<LeadSourceInput>) => updateSource(orgId, id, data), () => [`/scrapers/sources/${id}`, "/scrapers/sources"])
}

export async function deleteLeadSourceAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deleteSource(orgId, id), ["/scrapers/sources"], "/scrapers/sources")
}

export async function activateLeadSourceAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => activateSource(orgId, id), ["/scrapers/sources", `/scrapers/sources/${id}`])
}

export async function deactivateLeadSourceAction(id: string): Promise<ActionResult> {
  return mutate((orgId) => deactivateSource(orgId, id), ["/scrapers/sources", `/scrapers/sources/${id}`])
}

export async function runScraperAction(sourceId: string, icpId: string | null, test = false, name?: string): Promise<ActionResult> {
  const session = await requireSession()
  try {
    const run = await createRun(session.organization.id, session.user.id, { sourceId, icpId: icpId ?? undefined, test, name })
    enqueueRun(run.id)
    console.log(`scraper.run.created runId=${run.id} sourceId=${sourceId} test=${test} name=${name ?? ""}`)
    return { ok: true, id: run.id, redirectTo: `/scrapers/runs/${run.id}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" }
  }
}

export async function cancelRunAction(runId: string): Promise<ActionResult> {
  return mutate((orgId) => cancelRun(orgId, runId), [`/scrapers/runs/${runId}`, "/scrapers/runs"])
}

export async function deduplicateRunAction(runId: string): Promise<ActionResult> {
  return mutate((orgId) => deduplicateRun(orgId, runId), [`/lead-engine/duplicates`, `/scrapers/runs/${runId}`])
}

export async function confirmDuplicateAction(groupId: string): Promise<ActionResult> {
  return mutate(
    async (orgId, userId) => {
      const session = await requireSession()
      await confirmDuplicateGroup(orgId, groupId, { id: userId, name: session.user.name })
    },
    [`/lead-engine/duplicates/${groupId}`, "/lead-engine/duplicates"],
  )
}

export async function rejectDuplicateAction(groupId: string): Promise<ActionResult> {
  return mutate(
    async (orgId, userId) => {
      const session = await requireSession()
      await rejectDuplicateGroup(orgId, groupId, { id: userId, name: session.user.name })
    },
    [`/lead-engine/duplicates/${groupId}`, "/lead-engine/duplicates"],
  )
}

export async function runExtractionAction(runId: string): Promise<ActionResult> {
  return mutate(
    async (orgId) => {
      const started = await startExtraction(orgId, runId)
      if (!started.ok) throw new Error(started.error)
      enqueueExtractionRun(started.id)
    },
    [`/scrapers/runs/${runId}`],
  )
}

const TEXT_PREVIEW_MAX = 3000
const HEADINGS_MAX = 25

export async function convertCandidateAction(candidateId: string): Promise<ActionResult> {
  const session = await requireSession()
  try {
    const result = await convertCandidate(session.organization.id, candidateId, session.user.id)
    if (!result.ok) return { ok: false, error: result.error ?? "Conversion failed" }
    for (const path of ["/lead-engine/candidates", `/lead-engine/candidates/${candidateId}`, "/leads", "/companies", "/contacts", "/dashboard"]) {
      revalidatePath(path)
    }
    return { ok: true, redirectTo: result.conversion?.leadId ? `/leads/${result.conversion.leadId}` : undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Conversion failed" }
  }
}

export async function previewBulkAction(candidateIds: string[]): Promise<{ ok: boolean; plan?: PreviewPlan[]; error?: string }> {
  const session = await requireSession()
  try {
    return { ok: true, plan: await bulkPreview(session.organization.id, candidateIds) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Preview failed" }
  }
}

export async function bulkConvertAction(candidateIds: string[]): Promise<{ ok: boolean; summary?: BulkSummary; error?: string }> {
  const session = await requireSession()
  try {
    const summary = await bulkConvert(session.organization.id, candidateIds, session.user.id)
    revalidatePath("/lead-engine/candidates")
    revalidatePath("/leads")
    revalidatePath("/companies")
    revalidatePath("/contacts")
    revalidatePath("/dashboard")
    return { ok: true, summary }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Conversion failed" }
  }
}

export async function getRawPageAction(pageId: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true
      page: {
        url: string
        statusCode: number | null
        errorCategory: string | null
        title: string | null
        contentType: string | null
        canonicalUrl: unknown
        language: unknown
        headings: unknown
        textPreview: string
        metadata: Record<string, unknown>
        fetchedAt: string
        hasHtml: boolean
        truncatedText: boolean
        pageTooLarge: boolean
      }
    }
> {
  const session = await requireSession()
  const page = await getRawPage(session.organization.id, pageId)
  if (!page) return { ok: false, error: "Page not found in this organization" }
  const meta = (page.metadata ?? {}) as Record<string, unknown>
  return {
    ok: true,
    page: {
      url: page.url,
      statusCode: page.statusCode,
      errorCategory: page.errorCategory,
      title: page.title,
      contentType: page.contentType,
      canonicalUrl: meta.canonicalUrl,
      language: meta.language,
      headings: Array.isArray(meta.headings) ? meta.headings.slice(0, HEADINGS_MAX) : [],
      textPreview:
        (page.textContent ?? "").slice(0, TEXT_PREVIEW_MAX) +
        ((page.textContent?.length ?? 0) > TEXT_PREVIEW_MAX ? "…" : ""),
      metadata: meta,
      fetchedAt: page.fetchedAt.toISOString(),
      hasHtml: page.html !== null,
      truncatedText: meta.textTruncated === true,
      pageTooLarge: meta.pageTooLarge === true,
    },
  }
}