// Secrets never live in LeadSource.config. When a real source needs
// credentials, adapters reference keys here and resolve them server-side
// at run time from the process environment (LF_CRED_<KEY>).
export async function resolveCredentials(keys: string[]): Promise<Record<string, string>> {
  const resolved: Record<string, string> = {}
  for (const key of keys) {
    const value = process.env[`LF_CRED_${key.toUpperCase()}`]
    if (value) resolved[key] = value
  }
  return resolved
}