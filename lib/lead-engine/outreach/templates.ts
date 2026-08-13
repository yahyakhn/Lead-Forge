// TASK 015 §33-§35: safe template variable rendering. Only a fixed set of
// variables is substituted — no arbitrary code execution. Missing variables
// surface as warnings, never as raw "{{var}}" text in a final send (§34).

export type TemplateVariable = "first_name" | "last_name" | "company_name" | "job_title" | "sender_name"

export const TEMPLATE_VARIABLES: TemplateVariable[] = ["first_name", "last_name", "company_name", "job_title", "sender_name"]

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  first_name: "First name",
  last_name: "Last name",
  company_name: "Company name",
  job_title: "Job title",
  sender_name: "Sender name",
}

export interface TemplateContext {
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  job_title?: string | null
  sender_name?: string | null
}

export interface RenderedTemplate {
  subject: string
  body: string
  missing: TemplateVariable[]
}

export function extractVariables(text: string): TemplateVariable[] {
  return TEMPLATE_VARIABLES.filter((v) => text.includes(`{{${v}}}`)).sort((a, b) => text.indexOf(`{{${a}}}`) - text.indexOf(`{{${b}}}`))
}

export function renderTemplate(template: string, context: TemplateContext): RenderedTemplate {
  const used = extractVariables(template)
  const missing = used.filter((v) => !context[v])
  let rendered = template
  for (const v of used) {
    rendered = rendered.replaceAll(`{{${v}}}`, context[v] ?? "")
  }
  return { subject: rendered, body: rendered, missing }
}

// Escape any HTML-ish input before it reaches storage or rendering (§26-§27).
// The composer only produces plain text today; this is defense in depth.
export function sanitizeText(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .trim()
}

// Plain-text to safe HTML for display (§28). Paragraphs, bold, italic and
// lists from markdown-ish syntax are not claimed — display stays plain text
// in a <pre>-style block, so no HTML is ever rendered from user content.
export function plainTextBody(body: string): string {
  return body.replace(/\r\n/g, "\n").trim()
}