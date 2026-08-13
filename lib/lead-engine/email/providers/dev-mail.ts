// TASK 015 §16: development-mode mail provider. Never touches real
// recipients — outgoing messages are appended to a local JSONL log that the
// dev mailbox viewer (or `tail -f`) can display.

import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { EmailOutboundMessage, EmailSendResult, EmailSendingProvider } from "@/lib/lead-engine/email/providers/types"

export const DEV_MAIL_PROVIDER_ID = "dev"

const LOG_DIR = path.join(process.cwd(), "storage", "mail")
const LOG_FILE = path.join(LOG_DIR, "dev-outbox.jsonl")

export function devOutboxLogFile(): string {
  return LOG_FILE
}

export function readDevOutbox(limit = 50): Array<{ at: string; message: EmailOutboundMessage; messageId: string }> {
  try {
    const lines = readFileSync(LOG_FILE, "utf8").trim().split("\n")
    return lines.filter(Boolean).slice(-limit).map((l: string) => JSON.parse(l))
  } catch {
    return []
  }
}

export const devMailProvider: EmailSendingProvider = {
  id: DEV_MAIL_PROVIDER_ID,
  name: "Development Mailbox",
  capabilities: ["SENDING"],
  async send(message: EmailOutboundMessage): Promise<EmailSendResult> {
    const messageId = `dev-${randomUUID()}`
    try {
      mkdirSync(LOG_DIR, { recursive: true })
      appendFileSync(LOG_FILE, `${JSON.stringify({ at: new Date().toISOString(), messageId, message })}\n`)
      return { ok: true, providerMessageId: messageId }
    } catch (e) {
      return { ok: false, errorCode: "PROVIDER_UNAVAILABLE", errorMessage: e instanceof Error ? e.message : "failed to log" }
    }
  },
}