// TASK 014 §42-§44, §76-§77: email section rendered on lead + candidate pages.
// Server component; mutations go through server actions (no client JS needed).

import { requireSession } from "@/lib/auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmailStatusBadge, EmailTypeBadge, EmailDomainMatchBadge, ReadinessScore } from "@/components/crm/email-badges"
import { listEntityEmails, emailRateLimitRemaining } from "@/lib/lead-engine/email/service"
import { latestReadiness } from "@/lib/lead-engine/email/readiness"
import { formatDateTime } from "@/lib/format"
import { findEmailAction, verifyEmailAction, setPrimaryEmailAction, markEmailInvalidAction, removeEmailAction } from "@/lib/actions-email"

export async function EmailSection({ leadId, candidateId }: { leadId?: string; candidateId?: string }) {
  const session = await requireSession()
  const [emails, rate] = await Promise.all([
    listEntityEmails(session.organization.id, { leadId, candidateId }),
    emailRateLimitRemaining(session.organization.id),
  ])
  const readiness = candidateId ? await latestReadiness(session.organization.id, { candidateId }) : leadId ? await latestReadiness(session.organization.id, { leadId }) : null
  const reasons = (readiness?.reasons as string[] | null) ?? undefined

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Emails</CardTitle>
        <div className="flex items-center gap-2">
          <form action={findEmailAction}>
            {leadId ? <input type="hidden" name="leadId" value={leadId} /> : <input type="hidden" name="candidateId" value={candidateId} />}
            <Button type="submit" size="sm" variant="outline" disabled={rate.discovery === 0}>
              Find public email
            </Button>
          </form>
          <ReadinessScore score={readiness?.score ?? null} compact />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">No emails discovered yet. Run discovery to search existing public evidence.</p>
        ) : (
          <ul className="divide-y">
            {emails.map((email) => (
              <li key={email.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{email.email}</span>
                    {email.isPrimary && <span className="text-xs text-muted-foreground">primary</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <EmailTypeBadge type={email.type} />
                    <EmailDomainMatchBadge match={email.domainMatch} />
                    <span>Confidence {(email.confidence * 100).toFixed(0)}%</span>
                    {email.sourceUrl && <span className="max-w-56 truncate" title={email.sourceUrl}>{email.sourceUrl}</span>}
                  </div>
                  {email.sourceUrl && email.evidence && (
                    <p className="mt-1 truncate text-xs text-muted-foreground" title={email.evidence}>
                      &ldquo;{email.evidence}&rdquo;
                    </p>
                  )}
                  {email.expiresAt && (
                    <p className="mt-1 text-xs text-muted-foreground">Last checked {formatDateTime(email.verifiedAt!)} · expires {formatDateTime(email.expiresAt)}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <EmailStatusBadge status={email.status} />
                  <form action={verifyEmailAction}>
                    <input type="hidden" name="emailId" value={email.id} />
                    <Button type="submit" size="sm" variant="secondary" disabled={rate.verification === 0}>
                      Verify
                    </Button>
                  </form>
                  {!email.isPrimary && (
                    <form action={setPrimaryEmailAction}>
                      <input type="hidden" name="emailId" value={email.id} />
                      <Button type="submit" size="sm" variant="ghost">Set primary</Button>
                    </form>
                  )}
                  <form action={markEmailInvalidAction}>
                    <input type="hidden" name="emailId" value={email.id} />
                    <Button type="submit" size="sm" variant="ghost">Mark invalid</Button>
                  </form>
                  <form action={removeEmailAction}>
                    <input type="hidden" name="emailId" value={email.id} />
                    <Button type="submit" size="sm" variant="ghost">Remove</Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        {readiness && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Contact readiness</span>
              <ReadinessScore score={readiness.score} compact />
            </div>
            {reasons && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">Version {readiness.modelVersion} · {formatDateTime(readiness.calculatedAt)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}