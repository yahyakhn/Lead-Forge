// TASK 015 §15, §17: SMTP sending provider via nodemailer. Configuration is
// environment-only (never stored in the DB): EMAIL_SMTP_HOST, EMAIL_SMTP_PORT,
// EMAIL_SMTP_USER, EMAIL_SMTP_PASS, EMAIL_SMTP_SECURE (default true).
// With no host configured the provider is unusable — the service layer then
// reports "Email provider is not configured" and sending stays disabled.
// SMTP gives no delivery evidence, so we only ever claim SENT (§12).

import nodemailer from "nodemailer"
import type { EmailOutboundMessage, EmailSendResult, EmailSendingProvider } from "@/lib/lead-engine/email/providers/types"

export const SMTP_MAIL_PROVIDER_ID = "smtp"

export function smtpConfigured(): boolean {
  return Boolean(process.env.EMAIL_SMTP_HOST)
}

export const smtpMailProvider: EmailSendingProvider = {
  id: SMTP_MAIL_PROVIDER_ID,
  name: "SMTP",
  capabilities: ["SENDING"],
  async send(message: EmailOutboundMessage): Promise<EmailSendResult> {
    if (!smtpConfigured()) return { ok: false, errorCode: "NOT_CONFIGURED", errorMessage: "SMTP is not configured" }
    try {
      const transport = nodemailer.createTransport({
        host: process.env.EMAIL_SMTP_HOST!,
        port: Number(process.env.EMAIL_SMTP_PORT ?? 587),
        secure: (process.env.EMAIL_SMTP_SECURE ?? "false") === "true",
        auth: process.env.EMAIL_SMTP_USER
          ? { user: process.env.EMAIL_SMTP_USER, pass: process.env.EMAIL_SMTP_PASS }
          : undefined,
      })
      const info = await transport.sendMail({
        from: message.from,
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyTo: message.replyTo,
        subject: message.subject,
        text: message.body,
      })
      return { ok: true, providerMessageId: info.messageId ?? undefined }
    } catch (e) {
      const err = e as { code?: string; message?: string } | null
      const code = err?.code
      if (code === "EAUTH") return { ok: false, errorCode: "AUTH_FAILED", errorMessage: "Authentication failed" }
      if (code === "EENVELOPE") return { ok: false, errorCode: "INVALID_RECIPIENT", errorMessage: "Invalid recipient" }
      if (code === "EMAXLINES" || code === "ESMTP") return { ok: false, errorCode: "MESSAGE_REJECTED", errorMessage: "Message rejected" }
      return { ok: false, errorCode: "PROVIDER_UNAVAILABLE", errorMessage: err?.message ?? "SMTP error" }
    }
  },
}