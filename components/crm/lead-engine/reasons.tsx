export const REASON_LABELS: Record<string, string> = {
  DOMAIN_EXACT: "Exact company domain",
  EMAIL_EXACT: "Exact email",
  EMAIL_DOMAIN_EXACT: "Exact email domain",
  PHONE_EXACT: "Exact phone",
  LINKEDIN_EXACT: "Exact LinkedIn",
  WEBSITE_EXACT: "Website similarity",
  COMPANY_NAME_EXACT: "Exact company name",
  COMPANY_NAME_SIMILAR: "Similar company name",
  CONTACT_NAME_EXACT: "Exact contact name",
  CONTACT_NAME_SIMILAR: "Similar contact name",
  CONTACT_COMPANY_MATCH: "Same company",
  LOCATION_MATCH: "Same location",
  JOB_TITLE_MATCH: "Same job title",
}

export function Reasons({ reasons, max = 3 }: { reasons: string[]; max?: number }) {
  const visible = reasons.slice(0, max)
  return (
    <ul className="text-xs text-muted-foreground">
      {visible.map((reason) => (
        <li key={reason}>✓ {REASON_LABELS[reason] ?? reason}</li>
      ))}
      {reasons.length > max ? <li>+{reasons.length - max} more</li> : null}
    </ul>
  )
}