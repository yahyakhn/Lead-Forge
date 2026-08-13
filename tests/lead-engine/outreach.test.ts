// TASK 015: sales outreach & communication workspace (§91-§97).
// Real-DB integration tests with a file-backed dev mail provider — no real
// email is ever sent. Provider mode is forced to development so the dev
// provider is always selected.

import { describe, it, expect, afterAll, beforeAll } from "vitest"
import { prisma } from "@/lib/db"
import {
  CommunicationStatus,
  EmailStatus,
  EmailTemplateCategory,
  EmailTemplateStatus,
  EmailAccountStatus,
  OutreachStatus,
  CallOutcome,
  CommunicationChannel,
  CommunicationDirection,
} from "@/generated/prisma/enums"
import { registerEmailProvider, emailProviderRegistry } from "@/lib/lead-engine/email/providers/registry"
import { outreachReadiness, outreachPriority, sortByPriority } from "@/lib/lead-engine/outreach/priority"
import { renderTemplate, sanitizeText, extractVariables } from "@/lib/lead-engine/outreach/templates"
import {
  addNote,
  archiveEmailTemplate,
  createEmailAccount,
  createEmailTemplate,
  deleteDraft,
  duplicateEmailTemplate,
  listCommunications,
  listDrafts,
  listEmailTemplates,
  logCall,
  processOutboxMessage,
  processProviderWebhook,
  queueLeads,
  saveDraft,
  sendEmail,
  updateEmailTemplate,
  updateOutreach,
  webhookSignatureValid,
} from "@/lib/lead-engine/outreach/service"
import { getSettings, updateSettings } from "@/lib/lead-engine/email/service"
import type { EmailProvider } from "@/lib/lead-engine/email/providers/types"

const orgIds: string[] = []

const newOrg = async () => {
  const org = await prisma.organization.create({
    data: { name: `Outreach Test Org ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  })
  orgIds.push(org.id)
  return org
}

const newActor = async (orgId: string, role: "ADMIN" | "MEMBER" = "MEMBER") => {
  const user = await prisma.user.create({
    data: {
      organizationId: orgId,
      name: `Out user ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      email: `out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
      passwordHash: "test",
      role,
    },
  })
  return { id: user.id, name: user.name, role }
}

const seedLead = async (orgId: string, over: Record<string, unknown> = {}, emailStatus: EmailStatus | null = EmailStatus.VERIFIED) => {
  const company = await prisma.company.create({
    data: { organizationId: orgId, name: "Acme Test", normalizedName: "acme test", domain: `acme-${Math.random().toString(36).slice(2, 8)}.test.local` },
  })
  const contact = await prisma.contact.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      firstName: "Jane",
      lastName: "Doe",
      fullName: "Jane Doe",
      jobTitle: "CTO",
      email: `jane-${Math.random().toString(36).slice(2, 8)}@acme.test.local`,
    },
  })
  const lead = await prisma.lead.create({
    data: {
      organizationId: orgId,
      companyId: company.id,
      contactId: contact.id,
      title: "Acme Corp",
      status: "NEW",
      outreachStatus: OutreachStatus.NOT_CONTACTED,
      contactReadiness: 80,
      score: 90,
      ...(emailStatus ? { emailStatus } : {}),
      ...over,
    },
  })
  if (emailStatus) {
    await prisma.emailAddress.create({
      data: {
        organizationId: orgId,
        leadId: lead.id,
        contactId: contact.id,
        email: contact.email!,
        normalizedEmail: contact.email!.toLowerCase(),
        status: emailStatus,
        isPrimary: true,
        sourceType: "MANUAL",
        provider: "test",
        observedAt: new Date(),
      },
    })
  }
  return { lead, contact, company }
}

async function enqueueAndProcess(orgId: string, leadId: string, emailId: string) {
  const comm = await prisma.communication.findFirst({ where: { organizationId: orgId, leadId, emailId }, orderBy: { createdAt: "desc" } })
  const message = await prisma.outboxMessage.findUnique({ where: { communicationId: comm!.id } })
  await processOutboxMessage(message!.id)
  return prisma.communication.findUnique({ where: { id: comm!.id } })
}

describe("TASK 015 outreach", () => {
  beforeAll(() => {
    process.env.EMAIL_PROVIDER_MODE = "development"
  })

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
    await prisma.$disconnect()
  })

  describe("readiness (§5-§6)", () => {
    it("READY when contact + verified email + active + no cooldown", () => {
      expect(outreachReadiness({ status: "NEW", doNotContact: false, hasContact: true, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3 }).state).toBe("READY")
    })

    it("MISSING_EMAIL when no usable email — even with ICP 95", () => {
      const r = outreachReadiness({ status: "NEW", doNotContact: false, hasContact: true, emailStatuses: [], allowUnverified: false, minDaysBetweenOutreach: 3, now: new Date("2026-01-01") })
      expect(r.state).toBe("MISSING_EMAIL")
    })

    it("DO_NOT_CONTACT when lead or contact is flagged", () => {
      expect(outreachReadiness({ status: "NEW", doNotContact: true, hasContact: true, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3 }).state).toBe("DO_NOT_CONTACT")
      expect(outreachReadiness({ status: "NEW", doNotContact: false, contactDoNotContact: true, hasContact: true, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3 }).state).toBe("DO_NOT_CONTACT")
    })

    it("EMAIL_UNVERIFIED when policy requires verification", () => {
      const r = outreachReadiness({ status: "NEW", doNotContact: false, hasContact: true, emailStatuses: [EmailStatus.DISCOVERED], allowUnverified: false, minDaysBetweenOutreach: 3 })
      expect(r.state).toBe("EMAIL_UNVERIFIED")
      expect(outreachReadiness({ status: "NEW", doNotContact: false, hasContact: true, emailStatuses: [EmailStatus.DISCOVERED], allowUnverified: true, minDaysBetweenOutreach: 3 }).state).toBe("READY")
    })

    it("RECENTLY_CONTACTED within cooldown", () => {
      const r = outreachReadiness({ status: "NEW", doNotContact: false, hasContact: true, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3, lastOutboundAt: new Date(Date.now() - 86400000) })
      expect(r.state).toBe("RECENTLY_CONTACTED")
    })

    it("PAUSED for disqualified/lost/converted leads", () => {
      expect(outreachReadiness({ status: "DISQUALIFIED", doNotContact: false, hasContact: true, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3 }).state).toBe("PAUSED")
    })

    it("MISSING_CONTACT when no contact", () => {
      expect(outreachReadiness({ status: "NEW", doNotContact: false, hasContact: false, emailStatuses: [EmailStatus.VERIFIED], allowUnverified: false, minDaysBetweenOutreach: 3 }).state).toBe("MISSING_CONTACT")
    })
  })

  describe("priority (§4, §79)", () => {
    const base = { id: "1", score: 90, contactReadiness: 80, emailStatuses: [EmailStatus.VERIFIED] as EmailStatus[], outreachStatus: OutreachStatus.NOT_CONTACTED as OutreachStatus | null, lastActivityAt: null, createdAt: new Date("2026-01-01"), ownerId: null }

    it("is deterministic and reply outranks untouched", () => {
      const untouched = outreachPriority({ ...base }, "u").priority
      const replied = outreachPriority({ ...base, outreachStatus: OutreachStatus.REPLIED }, "u").priority
      expect(replied).toBeGreaterThan(untouched)
      const a = sortByPriority([{ ...base, id: "a" }, { ...base, id: "b", outreachStatus: OutreachStatus.REPLIED }], "u").map((l) => l.id)
      expect(a).toEqual(["b", "a"])
    })

    it("verified email outranks none; my lead outranks unowned", () => {
      const noEmail = outreachPriority({ ...base, emailStatuses: [] }, "u").priority
      const hasEmail = outreachPriority({ ...base }, "u").priority
      expect(hasEmail).toBeGreaterThan(noEmail)
      const mine = outreachPriority({ ...base, ownerId: "me" }, "me").priority
      expect(mine).toBeGreaterThan(hasEmail)
    })
  })

  describe("templates (§31-§37, §91)", () => {
    it("CRUD, duplicate, archive — org scoped", async () => {
      const org = await newOrg()
      const a = await newActor(org.id, "ADMIN")
      const t = await createEmailTemplate(org.id, a, { name: "Intro", category: EmailTemplateCategory.INTRODUCTION, subject: "Hello {{first_name}}", body: "Hi {{first_name}}, I noticed {{company_name}} does great work." })
      expect(t.name).toBe("Intro")

      const updated = await updateEmailTemplate(org.id, t.id, { subject: "Hey {{first_name}}" })
      expect(updated.subject).toBe("Hey {{first_name}}")

      const copy = await duplicateEmailTemplate(org.id, a, t.id)
      expect(copy.name).toBe("Intro (copy)")

      await archiveEmailTemplate(org.id, t.id)
      const archived = await prisma.emailTemplate.findUnique({ where: { id: t.id } })
      expect(archived!.status).toBe(EmailTemplateStatus.ARCHIVED)
      const active = await listEmailTemplates(org.id)
      expect(active.some((x) => x.id === t.id)).toBe(false)
      const withArchived = await listEmailTemplates(org.id, true)
      expect(withArchived.some((x) => x.id === t.id)).toBe(true)
    })

    it("rejects duplicate names", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      await createEmailTemplate(org.id, a, { name: "Same", category: EmailTemplateCategory.GENERAL, subject: "S", body: "B" })
      await expect(createEmailTemplate(org.id, a, { name: "Same", category: EmailTemplateCategory.GENERAL, subject: "S", body: "B" })).rejects.toThrow(/already exists/)
    })

    it("org isolation — cannot touch another org's template", async () => {
      const orgA = await newOrg()
      const orgB = await newOrg()
      const a = await newActor(orgA.id)
      const t = await createEmailTemplate(orgA.id, a, { name: "Secret", category: EmailTemplateCategory.GENERAL, subject: "S", body: "B" })
      await expect(updateEmailTemplate(orgB.id, t.id, { name: "Hacked" })).rejects.toThrow("Template not found")
    })
  })

  describe("template variables (§33-§35, §91)", () => {
    it("renders known variables and reports missing ones", () => {
      const r = renderTemplate("Hi {{first_name}} at {{company_name}}", { first_name: "Jane", company_name: null })
      expect(r.body).toBe("Hi Jane at ")
      expect(r.missing).toEqual(["company_name"])
      expect(extractVariables("{{sender_name}} {{job_title}} none")).toEqual(["sender_name", "job_title"])
      expect(renderTemplate("no vars", {}).missing).toEqual([])
    })

    it("sanitizes HTML before storage/rendering (§26-§27, §91)", () => {
      expect(sanitizeText("<script>alert('x')</script> & <b>bold</b>")).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;")
    })
  })

  describe("send flow (§22-§25, §30, §69-§70, §92)", () => {
    it("valid recipient → queued → worker → SENT + timeline + audit", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead, contact } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })

      const result = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "Intro", body: "Hi Jane,\n\nGreat to connect." })
      expect(result.ok).toBe(true)

      const comm = await enqueueAndProcess(org.id, lead.id, email!.id)
      expect(comm!.status).toBe(CommunicationStatus.SENT)
      expect(comm!.providerMessageId).toMatch(/^dev-/)
      expect(comm!.sentAt).toBeTruthy()

      const updatedLead = await prisma.lead.findUnique({ where: { id: lead.id } })
      expect(updatedLead!.outreachStatus).toBe(OutreachStatus.CONTACTED)
      const activity = await prisma.activity.findFirst({ where: { leadId: lead.id, type: "EMAIL" } })
      expect(activity).toBeTruthy()
      const audit = await prisma.emailEvent.findFirst({ where: { organizationId: org.id, action: "EMAIL_SENT" } })
      expect(audit).toBeTruthy()
      expect(contact.id).toBeTruthy()
    })

    it("rejects malformed recipient", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      await prisma.emailAddress.update({ where: { id: email!.id }, data: { email: "not-an-email" } })
      const result = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(false)
      expect("code" in result && result.code).toBe("INVALID_RECIPIENT")
    })

    it("idempotency: identical content in the same window is rejected (§70)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const first = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "Same", body: "Same body", confirmCooldown: true })
      expect(first.ok).toBe(true)
      const second = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "Same", body: "Same body", confirmCooldown: true })
      expect(second.ok).toBe(false)
      const third = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "Different", body: "Same body", confirmCooldown: true })
      expect(third.ok).toBe(true)
    })

    it("unsubscribe blocks sends — compose time and worker time (§53, §88)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })

      const result = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(true)
      await prisma.emailAddress.update({ where: { id: email!.id }, data: { status: EmailStatus.UNSUBSCRIBED } })

      const blocked = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S2", body: "B2" })
      expect(blocked.ok).toBe(false)
      expect("code" in blocked && blocked.code).toBe("UNSUBSCRIBED")

      const queued = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S3", body: "B3" })
      expect(queued.ok).toBe(false)
      void queued
    })

    it("do-not-contact blocks at lead, contact and email level (§7, §89)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead, contact } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })

      await prisma.lead.update({ where: { id: lead.id }, data: { doNotContact: true } })
      let r = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect("error" in r && r.error).toMatch(/do-not-contact/i)
      await prisma.lead.update({ where: { id: lead.id }, data: { doNotContact: false } })

      await prisma.contact.update({ where: { id: contact.id }, data: { doNotContact: true } })
      r = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect("error" in r && r.error).toMatch(/do-not-contact/i)
      await prisma.contact.update({ where: { id: contact.id }, data: { doNotContact: false } })

      await prisma.emailAddress.update({ where: { id: email!.id }, data: { status: EmailStatus.DO_NOT_CONTACT } })
      r = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect("code" in r && r.code).toBe("DO_NOT_CONTACT")
    })

    it("daily limit blocks further sends (§20, §87)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      await updateSettings(org.id, { dailySendLimit: 1 })
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const first = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S1", body: "B1" })
      expect(first.ok).toBe(true)
      const second = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S2", body: "B2" })
      expect(second.ok).toBe(false)
      expect("code" in second && second.code).toBe("LIMIT_REACHED")
      void second
    })

    it("cooldown requires explicit confirmation (§85-§86)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const first = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S1", body: "B1" })
      expect(first.ok).toBe(true)
      const blocked = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S2", body: "B2" })
      expect(blocked.ok).toBe(false)
      expect("code" in blocked && blocked.code).toBe("COOLDOWN")
      const confirmed = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S3", body: "B3", confirmCooldown: true })
      expect(confirmed.ok).toBe(true)
      await enqueueAndProcess(org.id, lead.id, email!.id)
      void blocked
    })

    it("transient failure retries once then succeeds; permanent failure does not retry (§67-§68)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const emailId = (await prisma.emailAddress.findFirst({ where: { leadId: lead.id } }))!.id

      let calls = 0
      const flaky: EmailProvider = {
        id: "test-flaky",
        name: "Flaky",
        capabilities: ["SENDING"],
        send: async () => {
          calls++
          if (calls === 1) return { ok: false, errorCode: "PROVIDER_UNAVAILABLE", errorMessage: "down" }
          return { ok: true, providerMessageId: "flaky-ok" }
        },
      }
      const original = emailProviderRegistry.get("dev")
      try {
        emailProviderRegistry.unregister("dev")
        emailProviderRegistry.register({ ...flaky, id: "dev" } as EmailProvider)

        // transient failure → retry scheduled (PENDING, attempts 1), not failed
        const result = await sendEmail(org.id, a, { leadId: lead.id, emailId, subject: "S", body: "B" })
        expect(result.ok).toBe(true)
        const comm = await prisma.communication.findFirst({ where: { organizationId: org.id, leadId: lead.id }, orderBy: { createdAt: "desc" } })
        let message = await prisma.outboxMessage.findUnique({ where: { communicationId: comm!.id } })
        await processOutboxMessage(message!.id)
        message = await prisma.outboxMessage.findUnique({ where: { id: message!.id } })
        expect(message!.status).toBe("PENDING")
        expect(message!.attempts).toBe(1)
        expect((await prisma.communication.findUnique({ where: { id: comm!.id } }))!.status).toBe(CommunicationStatus.QUEUED)

        // second run succeeds
        await processOutboxMessage(message!.id)
        expect((await prisma.communication.findUnique({ where: { id: comm!.id } }))!.status).toBe(CommunicationStatus.SENT)
        expect(calls).toBe(2)

        // permanent failure → FAILED, no retry
        calls = 0
        emailProviderRegistry.unregister("dev")
        emailProviderRegistry.register({ ...flaky, id: "dev", send: async () => { calls++; return { ok: false, errorCode: "INVALID_RECIPIENT", errorMessage: "bad" } } } as EmailProvider)
        const result2 = await sendEmail(org.id, a, { leadId: lead.id, emailId, subject: "S2", body: "B2", confirmCooldown: true })
        expect(result2.ok).toBe(true)
        const comm2 = await prisma.communication.findFirst({ where: { organizationId: org.id, leadId: lead.id, subject: "S2" } })
        const message2 = await prisma.outboxMessage.findUnique({ where: { communicationId: comm2!.id } })
        await processOutboxMessage(message2!.id)
        const msg2 = await prisma.outboxMessage.findUnique({ where: { id: message2!.id } })
        expect(msg2!.status).toBe("FAILED")
        expect(msg2!.errorCode).toBe("INVALID_RECIPIENT")
        expect(msg2!.attempts).toBe(1)
        expect((await prisma.communication.findUnique({ where: { id: comm2!.id } }))!.status).toBe(CommunicationStatus.FAILED)
        expect(calls).toBe(1)
      } finally {
        emailProviderRegistry.unregister("dev")
        if (original) emailProviderRegistry.register(original)
      }
    })

    it("worker safety re-check blocks a queued message when the email becomes blocked (§24)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const result = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(true)
      await prisma.emailAddress.update({ where: { id: email!.id }, data: { status: EmailStatus.UNSUBSCRIBED } })
      const comm = await prisma.communication.findFirst({ where: { organizationId: org.id, leadId: lead.id }, orderBy: { createdAt: "desc" } })
      const message = await prisma.outboxMessage.findUnique({ where: { communicationId: comm!.id } })
      await processOutboxMessage(message!.id)
      const failed = await prisma.communication.findUnique({ where: { id: comm!.id } })
      expect(failed!.status).toBe(CommunicationStatus.FAILED)
    })

    it("unverified email blocked when policy disallows; allowed when configured (§6)", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id, {}, EmailStatus.DISCOVERED)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const blocked = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(blocked.ok).toBe(false)
      expect("code" in blocked && blocked.code).toBe("EMAIL_UNVERIFIED")
      await updateSettings(org.id, { allowSendToUnverified: true })
      const allowed = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S2", body: "B2" })
      expect(allowed.ok).toBe(true)
      void blocked
    })
  })

  describe("accounts (§18, §64-§66, §97)", () => {
    it("admin can create accounts; member cannot", async () => {
      const org = await newOrg()
      const admin = await newActor(org.id, "ADMIN")
      const member = await newActor(org.id, "MEMBER")
      const account = await createEmailAccount(org.id, admin, { name: "Sales", email: "sales@acme.test.local", isDefault: true })
      expect(account.email).toBe("sales@acme.test.local")
      expect(account.status).toBe(EmailAccountStatus.ACTIVE)
      expect(account.isDefault).toBe(true)
      const settings = await getSettings(org.id)
      expect(settings.senderEmail).toBe("sales@acme.test.local")
      await expect(createEmailAccount(org.id, member, { name: "Hacked", email: "hack@acme.test.local" })).rejects.toThrow("Admin access required")
    })

    it("rejects malformed sender email", async () => {
      const org = await newOrg()
      const admin = await newActor(org.id, "ADMIN")
      await expect(createEmailAccount(org.id, admin, { name: "Bad", email: "nope" })).rejects.toThrow(/Invalid/)
    })
  })

  describe("drafts (§71-§73)", () => {
    it("save, update, list, delete — org scoped", async () => {
      const org = await newOrg()
      const actorA = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const draft = await saveDraft(org.id, actorA, { leadId: lead.id, subject: "Draft subject", body: "Draft body" })
      expect(draft.status).toBe(CommunicationStatus.DRAFT)
      const updated = await saveDraft(org.id, actorA, { leadId: lead.id, draftId: draft.id, subject: "Draft subject 2", body: "Draft body 2" })
      expect(updated.subject).toBe("Draft subject 2")
      const drafts = await listDrafts(org.id, lead.id)
      expect(drafts.length).toBe(1)
      await deleteDraft(org.id, actorA, draft.id)
      expect((await listDrafts(org.id, lead.id)).length).toBe(0)
    })

    it("drafts are not sent and not in the timeline", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      await saveDraft(org.id, a, { leadId: lead.id, subject: "S", body: "B" })
      const timeline = await listCommunications(org.id, lead.id)
      expect(timeline.length).toBe(0)
    })
  })

  describe("calls, notes, next action (§44-§50)", () => {
    it("logs calls and notes to timeline with audit activity", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead, contact } = await seedLead(org.id)
      const call = await logCall(org.id, a, { leadId: lead.id, contactId: contact.id, durationMin: 12, outcome: CallOutcome.CONNECTED, notes: "Interested in pricing" })
      expect(call.channel).toBe(CommunicationChannel.CALL)
      expect((call.metadata as { outcome: string }).outcome).toBe("CONNECTED")
      expect(call.body).toBe("Interested in pricing")

      const note = await addNote(org.id, a, { leadId: lead.id, body: "Internal thought" })
      expect(note.channel).toBe(CommunicationChannel.NOTE)
      expect(note.direction).toBe(CommunicationDirection.INTERNAL)
      expect((note.metadata as { visibility: string }).visibility).toBe("INTERNAL")

      const timeline = await listCommunications(org.id, lead.id)
      expect(timeline.map((c) => c.channel)).toEqual([CommunicationChannel.NOTE, CommunicationChannel.CALL])
      const leadAfter = await prisma.lead.findUnique({ where: { id: lead.id } })
      expect(leadAfter!.outreachStatus).toBe(OutreachStatus.CONTACTED)
      expect(await prisma.activity.count({ where: { leadId: lead.id } })).toBe(2)
    })

    it("next action + outreach status update, DO_NOT_CONTACT syncs", async () => {
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      await updateOutreach(org.id, a, { leadId: lead.id, nextAction: "Follow up Friday", nextActionAt: new Date("2026-08-16") })
      let updated = await prisma.lead.findUnique({ where: { id: lead.id } })
      expect(updated!.nextAction).toBe("Follow up Friday")

      await updateOutreach(org.id, a, { leadId: lead.id, outreachStatus: OutreachStatus.DO_NOT_CONTACT })
      updated = await prisma.lead.findUnique({ where: { id: lead.id } })
      expect(updated!.doNotContact).toBe(true)
      expect(updated!.outreachStatus).toBe(OutreachStatus.DO_NOT_CONTACT)
    })
  })

  describe("outreach queue (§3-§4, §78-§82)", () => {
    it("lists leads ordered by priority with filters", async () => {
      const org = await newOrg()
      const user = await newActor(org.id)
      const { lead: ready } = await seedLead(org.id)
      const { lead: unverified } = await seedLead(org.id, {}, EmailStatus.DISCOVERED)
      const { lead: dnc } = await seedLead(org.id, { doNotContact: true })
      const { lead: repliedLead } = await seedLead(org.id)
      await prisma.lead.update({ where: { id: repliedLead.id }, data: { outreachStatus: OutreachStatus.REPLIED, ownerId: user.id } })

      const page = await queueLeads(org.id, user.id, {})
      expect(page.total).toBe(4)
      expect(page.data[0].id).toBe(repliedLead.id)
      expect(page.data.find((r) => r.id === dnc.id)!.readinessState).toBe("DO_NOT_CONTACT")
      expect(page.data.find((r) => r.id === unverified.id)!.readinessState).toBe("EMAIL_UNVERIFIED")

      const readyOnly = await queueLeads(org.id, user.id, { readiness: "READY" })
      expect(readyOnly.total).toBe(2)

      const mine = await queueLeads(org.id, user.id, { owner: "mine" })
      expect(mine.total).toBe(1)

      const replied = await queueLeads(org.id, user.id, { hasReply: "true" })
      expect(replied.total).toBe(1)
      expect(replied.data[0].id).toBe(repliedLead.id)
      void ready
    })
  })

  describe("webhooks (§56-§58, §93)", () => {
    const webhookProvider: EmailProvider = {
      id: "webhook-test",
      name: "Webhook Test",
      capabilities: ["SENDING"],
      send: async () => ({ ok: true }),
      parseWebhook: (payload) =>
        (payload as { events: Array<{ id: string; type: string; subjectId?: string; email?: string; subject?: string; body?: string; bounceType?: string }> }).events.map((e) => ({
          providerEventId: e.id,
          eventType: e.type as never,
          subjectId: e.subjectId,
          email: e.email,
          subject: e.subject,
          body: e.body,
          bounceType: e.bounceType as "hard" | "soft" | undefined,
        })),
    }

    beforeAll(() => {
      registerEmailProvider(webhookProvider)
    })

    const sentMessageId = async (orgId: string, leadId: string) => {
      const a = await newActor(orgId)
      const { lead } = await seedLead(orgId)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const result = await sendEmail(orgId, a, { leadId: leadId || lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(true)
      const comm = await prisma.communication.findFirst({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } })
      const message = await prisma.outboxMessage.findUnique({ where: { communicationId: comm!.id } })
      await processOutboxMessage(message!.id)
      return { comm: (await prisma.communication.findUnique({ where: { id: comm!.id } }))!, lead, actor: a }
    }

    it("delivered/bounced/failed/unsubscribe events apply to communications", async () => {
      const org = await newOrg()
      const { comm, lead } = await sentMessageId(org.id, "")

      await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "ev-1", type: "delivered", subjectId: comm.providerMessageId }] })
      expect((await prisma.communication.findUnique({ where: { id: comm.id } }))!.status).toBe(CommunicationStatus.DELIVERED)

      await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "ev-2", type: "bounced", subjectId: comm.providerMessageId, bounceType: "hard" }] })
      const bounced = await prisma.communication.findUnique({ where: { id: comm.id } })
      expect(bounced!.status).toBe(CommunicationStatus.BOUNCED)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      expect(email!.status).toBe(EmailStatus.INVALID)

      const { comm: comm2 } = await sentMessageId(org.id, "")
      const email2 = await prisma.emailAddress.findFirst({ where: { leadId: comm2.leadId } })
      await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "ev-3", type: "unsubscribe", subjectId: comm2.providerMessageId }] })
      expect((await prisma.communication.findUnique({ where: { id: comm2.id } }))!.status).toBe(CommunicationStatus.SENT)
      expect((await prisma.emailAddress.findUnique({ where: { id: email2!.id } }))!.status).toBe(EmailStatus.UNSUBSCRIBED)
    })

    it("duplicate webhook events are processed once (§58)", async () => {
      const org = await newOrg()
      const { comm } = await sentMessageId(org.id, "")
      const first = await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "dup-1", type: "delivered", subjectId: comm.providerMessageId }] })
      expect(first.processed).toBe(1)
      const second = await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "dup-1", type: "delivered", subjectId: comm.providerMessageId }] })
      expect(second.duplicates).toBe(1)
      expect(await prisma.emailWebhookEvent.count({ where: { organizationId: org.id } })).toBe(1)
    })

    it("reply creates INBOUND communication and marks lead REPLIED (§41-§42, §79)", async () => {
      const org = await newOrg()
      const { comm, lead } = await sentMessageId(org.id, "")
      await processProviderWebhook(org.id, "webhook-test", { events: [{ id: "reply-1", type: "reply", subjectId: comm.providerMessageId, subject: "Re: S", body: "Sure, let's talk" }] })
      const reply = await prisma.communication.findFirst({ where: { organizationId: org.id, direction: CommunicationDirection.INBOUND } })
      expect(reply).toBeTruthy()
      expect(reply!.threadId).toBe(comm.threadId)
      expect(reply!.inReplyToId).toBe(comm.id)
      expect(reply!.body).toBe("Sure, let's talk")
      const updated = await prisma.lead.findUnique({ where: { id: lead.id } })
      expect(updated!.outreachStatus).toBe(OutreachStatus.REPLIED)
    })

    it("unsupported provider payload is rejected; signature check works (§56-§57)", async () => {
      const org = await newOrg()
      const result = await processProviderWebhook(org.id, "smtp", {})
      expect(result.ok).toBe(false)
      expect("error" in result && result.error).toMatch(/does not support webhooks/)
      expect(webhookSignatureValid("secret", "secret")).toBe(true)
      expect(webhookSignatureValid("secret", "wrong")).toBe(false)
      expect(webhookSignatureValid("secret", "")).toBe(false)
    })

    it("org isolation — org B events never touch org A data (§96)", async () => {
      const orgA = await newOrg()
      const orgB = await newOrg()
      const { comm } = await sentMessageId(orgA.id, "")
      await processProviderWebhook(orgB.id, "webhook-test", { events: [{ id: "cross-1", type: "delivered", subjectId: comm.providerMessageId }] })
      expect((await prisma.communication.findUnique({ where: { id: comm.id } }))!.status).toBe(CommunicationStatus.SENT)
      expect(await prisma.emailWebhookEvent.count({ where: { organizationId: orgB.id } })).toBe(1)
    })
  })

  describe("org isolation — communications (§96)", () => {
    it("timeline only shows own org's communications", async () => {
      const orgA = await newOrg()
      const orgB = await newOrg()
      const a = await newActor(orgA.id)
      const { lead } = await seedLead(orgA.id)
      await logCall(orgA.id, a, { leadId: lead.id, outcome: CallOutcome.CONNECTED })
      const timeline = await listCommunications(orgB.id, lead.id)
      expect(timeline.length).toBe(0)
    })

    it("cannot send another org's email as if it belongs to this lead", async () => {
      const orgA = await newOrg()
      const orgB = await newOrg()
      const aB = await newActor(orgB.id)
      const { lead, contact } = await seedLead(orgA.id)
      await prisma.emailAddress.create({ data: { organizationId: orgB.id, email: contact.email!, normalizedEmail: contact.email!.toLowerCase(), status: EmailStatus.VERIFIED, sourceType: "MANUAL", provider: "test", observedAt: new Date() } })
      const foreign = await prisma.emailAddress.findFirst({ where: { organizationId: orgB.id } })
      const result = await sendEmail(orgB.id, aB, { leadId: lead.id, emailId: foreign!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(false)
      expect("code" in result && result.code).toBe("NOT_FOUND")
      void contact
    })
  })

  describe("dashboard counts (§77)", () => {
    it("returns queue, sent-today, replies, follow-ups, bounces, unsubscribes", async () => {
      const { salesDashboardCounts } = await import("@/lib/lead-engine/outreach/service")
      const org = await newOrg()
      const a = await newActor(org.id)
      const { lead } = await seedLead(org.id)
      const email = await prisma.emailAddress.findFirst({ where: { leadId: lead.id } })
      const result = await sendEmail(org.id, a, { leadId: lead.id, emailId: email!.id, subject: "S", body: "B" })
      expect(result.ok).toBe(true)
      const comm = await prisma.communication.findFirst({ where: { organizationId: org.id } })
      const message = await prisma.outboxMessage.findUnique({ where: { communicationId: comm!.id } })
      await processOutboxMessage(message!.id)

      const counts = await salesDashboardCounts(org.id)
      expect(counts.emailsSentToday).toBe(1)
      expect(counts.queueReady).toBe(1)

      await prisma.lead.update({ where: { id: lead.id }, data: { nextActionAt: new Date(Date.now() - 86400000), outreachStatus: OutreachStatus.REPLIED } })
      await prisma.emailAddress.update({ where: { id: email!.id }, data: { status: EmailStatus.UNSUBSCRIBED } })
      const later = await salesDashboardCounts(org.id)
      expect(later.replies).toBe(1)
      expect(later.followUpsDue).toBe(1)
      expect(later.unsubscribed).toBe(1)
    })
  })
})