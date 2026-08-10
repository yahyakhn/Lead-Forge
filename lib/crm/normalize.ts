export function normalizeDomain(raw: string): string | null {
  const input = raw.trim().toLowerCase()
  if (!input) return null
  const withProtocol = /^https?:\/\//.test(input) ? input : `https://${input}`
  try {
    const { hostname } = new URL(withProtocol)
    if (!hostname.includes(".") || hostname === "localhost") return null
    return hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

export function normalizeCompanyName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ")
}

export function buildFullName(firstName: string, lastName?: string): string {
  return lastName ? `${firstName} ${lastName}`.trim() : firstName.trim()
}