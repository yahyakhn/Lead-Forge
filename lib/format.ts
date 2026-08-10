const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—"
  return dateFmt.format(new Date(d))
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—"
  return dateTimeFmt.format(new Date(d))
}

export function relativeDay(d: Date): string {
  const now = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((start(now) - start(d)) / 86400000)
  if (diffDays <= 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  return dateFmt.format(d)
}

export function formatDuration(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  if (!start || !end) return "—"
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 0) return "—"
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

export function formatMoney(value: string | number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined) return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (Number.isNaN(n)) return String(value)
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n)
  } catch {
    return `${currency} ${n}`
  }
}