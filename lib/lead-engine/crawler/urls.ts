import net from "node:net"
import dns from "node:dns/promises"
import { lookup as lookupCallback, type LookupAddress, type LookupOptions } from "node:dns"

// URL validation/normalization and SSRF protection shared by the crawler.
// Only http/https targets are ever considered (spec §10).

const CRAWL_PROTOCOLS = new Set(["http:", "https:"])

export function isValidCrawlUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return CRAWL_PROTOCOLS.has(url.protocol) && url.hostname.length > 0
  } catch {
    return false
  }
}

// Conservative normalization (spec §11): lowercase scheme/host, drop
// fragments, default ports and empty queries, strip a single trailing slash
// from non-root paths. Never touches query params or path segments.
export function normalizeUrl(value: string): string | null {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (!CRAWL_PROTOCOLS.has(url.protocol)) return null
  if (!url.hostname || url.hostname.includes("..") || url.hostname.endsWith(".")) return null
  url.hash = ""
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = ""
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1)
  if (url.search === "?") url.search = ""
  return url.toString()
}

export function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

// Domain restriction (spec §9). An allowed entry of "example.com" matches
// example.com itself AND its subdomains (blog.example.com); a subdomain entry
// matches only itself and deeper subdomains. An empty list allows any domain.
export function isDomainAllowed(url: string, allowedDomains: string[] | undefined): boolean {
  if (!allowedDomains || allowedDomains.length === 0) return true
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return allowedDomains.some((domain) => {
    const d = domain.trim().toLowerCase().replace(/^\.+/, "")
    if (!d) return false
    return hostname === d || hostname.endsWith(`.${d}`)
  })
}

function isIpv4Mapped(ip: string): string | null {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  return m ? m[1] : null
}

const blockedV4 = new net.BlockList()
blockedV4.addSubnet("0.0.0.0", 8, "ipv4")
blockedV4.addSubnet("127.0.0.0", 8, "ipv4")
blockedV4.addSubnet("10.0.0.0", 8, "ipv4")
blockedV4.addSubnet("100.64.0.0", 10, "ipv4")
blockedV4.addSubnet("172.16.0.0", 12, "ipv4")
blockedV4.addSubnet("192.168.0.0", 16, "ipv4")
blockedV4.addSubnet("169.254.0.0", 16, "ipv4")
blockedV4.addSubnet("224.0.0.0", 4, "ipv4")
blockedV4.addSubnet("240.0.0.0", 4, "ipv4")

const blockedV6 = new net.BlockList()
blockedV6.addSubnet("::", 128, "ipv6")
blockedV6.addSubnet("::1", 128, "ipv6")
blockedV6.addSubnet("fc00::", 7, "ipv6")
blockedV6.addSubnet("fe80::", 10, "ipv6")
blockedV6.addSubnet("ff00::", 8, "ipv6")
blockedV6.addSubnet("2001:db8::", 32, "ipv6")

// Returns true when the address must never be fetched (spec §43).
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase()
  const mapped = isIpv4Mapped(ip)
  if (mapped) return blockedV4.check(mapped, "ipv4")
  if (net.isIPv4(ip)) return blockedV4.check(ip, "ipv4")
  if (net.isIPv6(ip)) return blockedV6.check(ip, "ipv6")
  return false
}

// Per-origin DNS resolution + validation, cached for the duration of a crawl.
// Resolving happens here (and again inside the HTTP client via dnsLookup),
// so a public hostname that resolves to a private IP is never fetched.
export function createSsrFGuard() {
  const cache = new Map<string, { ok: boolean }>()

  async function checkHostname(hostname: string): Promise<{ ok: boolean; address?: string }> {
    const cached = cache.get(hostname)
    if (cached) return cached
    let result: { ok: boolean; address?: string }
    if (net.isIP(hostname)) {
      result = isPrivateAddress(hostname) ? { ok: false, address: hostname } : { ok: true }
    } else {
      try {
        const entries = await dns.lookup(hostname, { all: true })
        const blocked = entries.find((entry) => isPrivateAddress(entry.address))
        result = blocked ? { ok: false, address: blocked.address } : { ok: true }
      } catch {
        result = { ok: false }
      }
    }
    cache.set(hostname, result)
    return result
  }

  // Full check for a URL: literal IPs, resolved IPs (spec §43).
  async function checkUrl(url: string): Promise<{ ok: boolean; reason?: string }> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, reason: "malformed URL" }
    }
    if (!CRAWL_PROTOCOLS.has(parsed.protocol)) return { ok: false, reason: `unsupported protocol ${parsed.protocol}` }
    const result = await checkHostname(parsed.hostname)
    if (!result.ok) return { ok: false, reason: `hostname resolves to blocked address ${result.address ?? "unknown"}` }
    return { ok: true }
  }

  // net.lookup-compatible function injected into the HTTP client, so every
  // connection (including redirect hops, spec §44) is validated.
function safeLookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void): void {
  void (async () => {
    const result = await checkHostname(hostname)
    if (!result.ok) {
      const err = new Error(`SSRF: ${hostname} resolves to blocked address ${result.address ?? "unknown"}`) as NodeJS.ErrnoException
      return callback(err, "", 0)
    }
    lookupCallback(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "", 0)
        const first = Array.isArray(addresses) ? addresses[0] : addresses
        callback(null, first.address, first.family)
      })
    })()
  }

  return { checkUrl, safeLookup }
}

export type SsrFGuard = ReturnType<typeof createSsrFGuard>