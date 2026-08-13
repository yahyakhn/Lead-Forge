import Link from "next/link"
import { notFound } from "next/navigation"
import { requireSession } from "@/lib/auth"
import { getCandidate } from "@/lib/lead-engine/extraction/service"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/crm/page-header"
import { CandidateStatusBadge, ExtractionMethodBadge } from "@/components/crm/lead-engine/candidate-badges"
import { ConvertCandidateButton } from "@/components/crm/lead-engine/convert-candidate-button"
import { previewCandidate, canConvertCandidate, type PreviewPlan } from "@/lib/lead-engine/conversion/service"
import { formatDateTime } from "@/lib/format"
import { humanize } from "@/lib/crm/icp-shared"
import { ScoreBadge, QualificationBadge } from "@/components/crm/badges"
import { ScoreBreakdown } from "@/components/crm/score-breakdown"
import { latestCandidateScore } from "@/lib/lead-engine/scoring/service"
import type { CriterionResult } from "@/lib/lead-engine/scoring/engine"
import { RescoreButton } from "@/components/crm/lead-engine/rescore-button"
import { PreviewScoreButton } from "@/components/crm/lead-engine/preview-score-button"
import { EnrichButton } from "@/components/crm/lead-engine/enrich-button"
import { ResolveConflictButtons } from "@/components/crm/lead-engine/resolve-conflict-buttons"
import { EnrichmentStatusBadge } from "@/components/crm/badges"
import { latestEntityRequest, listEntityResults, listEntityConflicts } from "@/lib/lead-engine/enrichment/service"
import { FIELD_LABELS } from "@/lib/lead-engine/enrichment/fields"

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm break-words">{value ?? "—"}</dd>
    </div>
  )
}

function JsonBlock({ data }: { data: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-muted/50 p-4 font-mono text-xs leading-relaxed break-words">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export default async function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const candidate = await getCandidate(session.organization.id, id)
  if (!candidate) notFound()

  const latestScore = await latestCandidateScore(session.organization.id, id)

  const provenance = (candidate.fieldProvenance ?? {}) as Record<string, { value?: string; method?: string; sourceUrl?: string; evidenceType?: string; rejected?: string; duplicate_of?: string }>
  const rawData = candidate.rawData as { deterministic?: { evidence?: unknown } } | null

  const qualityExplanation = (candidate.qualityExplanation ?? {}) as Record<string, { label: string; earned: number; note: string }>
  const qualityFlags = (candidate.qualityFlags ?? []) as string[]
  const memberships = await prisma.duplicateGroupMember.findMany({
    where: { organizationId: session.organization.id, candidateId: candidate.id },
    include: {
      duplicateGroup: {
        select: { id: true, status: true, entityType: true, canonicalCandidateId: true, confidence: true, createdAt: true },
      },
    },
  })

  const eligibility = canConvertCandidate(candidate)
  const preview: PreviewPlan | null = eligibility.eligible
    ? await previewCandidate(session.organization.id, candidate.id).catch(() => null)
    : null

  const [latestEnrichment, enrichmentResults, enrichmentConflicts] = await Promise.all([
    latestEntityRequest(session.organization.id, { candidateId: candidate.id }),
    listEntityResults(session.organization.id, { candidateId: candidate.id }),
    listEntityConflicts(session.organization.id, { candidateId: candidate.id }),
  ])

  const actionLabel = (action: string | undefined) =>
    action === "CREATE" ? "create" : action === "REUSE" ? "reuse" : action === "BLOCKED" ? "blocked" : "—"

  return (
    <div>
      <PageHeader
        title={candidate.companyName ?? "Unnamed candidate"}
        description={
          <>
            Lead candidate from{" "}
            <Link href={`/scrapers/runs/${candidate.runId}`} className="underline-offset-4 hover:underline">
              run #{candidate.runId.slice(-6)}
            </Link>{" "}
            · {candidate.source.name} · {formatDateTime(candidate.createdAt)}
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        This is a lead <strong>candidate</strong> extracted from a crawled page — it has not been verified or confirmed as a CRM lead. Identity and quality are assessed here before conversion.
      </div>

      <div className="mb-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Convert to CRM</h2>
            {eligibility.eligible ? (
              preview ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Company {actionLabel(preview.company.action)} · Contact {actionLabel(preview.contact.action)} · Lead{" "}
                  <span className="font-medium">{preview.lead.title}</span> ({actionLabel(preview.lead.action)})
                  {preview.lead.action === "REUSE" ? " — a lead already exists for this company + contact" : ""}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Preview unavailable.</p>
              )
            ) : (
              <p className="mt-1 text-sm text-amber-600">{eligibility.reason ? `Not convertible: ${eligibility.reason}` : "Not convertible."}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <CandidateStatusBadge status={candidate.status} />
            {eligibility.eligible ? <ConvertCandidateButton candidateId={candidate.id} /> : null}
          </div>
        </div>
      </div>

      {memberships.length > 0 ? (
        <div className="mb-4 rounded-xl border bg-card p-4">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Duplicate groups</h2>
          <ul className="mt-2 space-y-1">
            {memberships.map((m) => (
              <li key={m.duplicateGroup.id} className="text-sm">
                <Link href={`/lead-engine/duplicates/${m.duplicateGroup.id}`} className="underline-offset-4 hover:underline">
                  {m.duplicateGroup.entityType.toLowerCase()} group · {m.duplicateGroup.status.replaceAll("_", " ")}
                  {m.duplicateGroup.canonicalCandidateId === candidate.id ? " · canonical" : ""}
                </Link>
                {m.duplicateGroup.confidence !== null ? <span className="text-xs text-muted-foreground"> · score {m.duplicateGroup.confidence}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mb-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Lead Score</h2>
            {latestScore ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Scored with ICP profile <code className="px-1 rounded bg-muted">{latestScore.icpProfileId?.slice(-8)}</code> (v{latestScore.modelVersion}) · {formatDateTime(latestScore.scoredAt)}
                {latestScore.scoreStatus === "STALE" && <span className="ml-2 text-amber-600">⚠ Stale</span>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Not scored yet.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {latestScore && (
              <>
                <ScoreBadge score={latestScore.icpScore} />
                <ScoreBadge score={latestScore.overallScore} />
                <QualificationBadge qualification={latestScore.qualification} />
              </>
            )}
          </div>
        </div>
        {latestScore && (
          <div className="mt-4">
            <ScoreBreakdown
              breakdown={(latestScore.scoreBreakdown as unknown as CriterionResult[]) ?? []}
              reasons={(latestScore.reasons as unknown as string[]) ?? []}
            />
          </div>
        )}
        {(!latestScore || latestScore.scoreStatus === "STALE") && (
          <div className="mt-4 pt-4 border-t">
            <RescoreButton kind="candidate" id={id} disabled={!latestScore} />
          </div>
        )}
        <div className="mt-4 pt-4 border-t">
          <PreviewScoreButton kind="candidate" id={id} />
        </div>
      </div>

      <div className="mb-4 rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Enrichment</h2>
            {latestEnrichment ? (
              <p className="mt-1 text-sm text-muted-foreground">
                <EnrichmentStatusBadge status={latestEnrichment.status} errorCode={latestEnrichment.errorCode} /> · {formatDateTime(latestEnrichment.requestedAt)} · {latestEnrichment.fieldsUpdated} field(s) updated
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">Fetch contact and company details from the candidate&apos;s website.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <EnrichButton kind="candidate" id={candidate.id} force={false} />
            <EnrichButton kind="candidate" id={candidate.id} force label="Refresh" />
          </div>
        </div>

        {enrichmentResults.length > 0 ? (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Field</th>
                <th className="py-1.5 pr-4 font-medium">Value</th>
                <th className="py-1.5 pr-4 font-medium">Source</th>
                <th className="py-1.5 pr-4 text-right font-medium">Confidence</th>
                <th className="py-1.5 pr-4 font-medium">Status</th>
                <th className="py-1.5 font-medium">Observed</th>
              </tr>
            </thead>
            <tbody>
              {enrichmentResults.map((result) => (
                <tr key={result.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-4 font-mono text-xs align-top">{FIELD_LABELS[result.field as keyof typeof FIELD_LABELS] ?? result.field}</td>
                  <td className="py-1.5 pr-4 break-all">{result.value}</td>
                  <td className="py-1.5 pr-4 text-xs text-muted-foreground">{result.source}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{Math.round(result.confidence * 100)}%</td>
                  <td className="py-1.5 pr-4 text-xs">
                    {result.status === "CONFLICT" ? (
                      <span className="text-amber-600">conflict</span>
                    ) : result.status === "REJECTED" ? (
                      <span className="text-destructive">rejected</span>
                    ) : result.status === "CONFIRMED" ? (
                      <span className="text-blue-600">matched</span>
                    ) : (
                      <span className="text-emerald-600">applied</span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs text-muted-foreground">{formatDateTime(result.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No enrichment results yet.</p>
        )}

        {enrichmentConflicts.length > 0 ? (
          <div className="mt-4 border-t pt-4">
            <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pending conflicts</h3>
            <ul className="mt-2 space-y-2">
              {enrichmentConflicts.map((conflict) => (
                <li key={conflict.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-mono text-xs">{FIELD_LABELS[conflict.field as keyof typeof FIELD_LABELS] ?? conflict.field}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Existing: <span className="text-foreground">{conflict.existingValue}</span> ({conflict.existingSource}) · Enriched:{" "}
                    <span className="text-foreground">{conflict.enrichedValue}</span> ({conflict.enrichedSource}, {Math.round(conflict.confidence * 100)}% conf.)
                  </p>
                  <div className="mt-2">
                    <ResolveConflictButtons conflictId={conflict.id} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mb-4 grid gap-4 rounded-xl border bg-card p-5 lg:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Data quality</h2>
            {candidate.dataQualityScore !== null ? (
              <span
                className={`text-lg font-semibold tabular-nums ${
                  candidate.dataQualityScore >= 70 ? "text-emerald-600 dark:text-emerald-400" : candidate.dataQualityScore >= 40 ? "text-amber-600 dark:text-amber-400" : "text-destructive"
                }`}
              >
                {candidate.dataQualityScore}/100
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">not assessed</span>
            )}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            {Object.entries(qualityExplanation).map(([key, w]) => (
              <li key={key} className="flex items-center gap-1.5">
                <span className={w.earned >= 10 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}>
                  {w.earned >= 10 ? "✓" : "⚠"}
                </span>
                <span className={w.earned >= 10 ? "" : "text-muted-foreground"}>{w.label}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quality flags</h2>
          {qualityFlags.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No flags.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {qualityFlags.map((flag) => (
                <li key={flag} className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {flag.replaceAll("_", " ").toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Company</h2>
            <ExtractionMethodBadge method={candidate.extractionMethod} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4">
            <Field label="Company name" value={candidate.companyName} />
            <Field label="Domain" value={candidate.companyDomain} />
            <Field label="Website" value={candidate.websiteUrl} />
            <Field label="Industry" value={candidate.industry} />
            <Field label="Country" value={candidate.country} />
            <Field label="Region" value={candidate.region} />
            <Field label="City" value={candidate.city} />
            <Field label="Page classification" value={candidate.pageClassification ? humanize(candidate.pageClassification) : null} />
            <Field label="Extraction confidence" value={candidate.extractionConfidence !== null ? `${Math.round(candidate.extractionConfidence * 100)}%` : null} />
          </dl>
          {candidate.description ? (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Description</p>
              <p className="mt-1 text-sm">{candidate.description}</p>
            </div>
          ) : null}
          {candidate.socialLinks && Array.isArray(candidate.socialLinks) && (candidate.socialLinks as string[]).length > 0 ? (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground">Social links</p>
              <ul className="mt-1 space-y-0.5">
                {(candidate.socialLinks as string[]).map((link) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="space-y-6">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contact</h2>
              <CandidateStatusBadge status={candidate.status} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <Field label="Name" value={candidate.contactFullName} />
              <Field label="Job title" value={candidate.contactJobTitle} />
              <Field label="Email" value={candidate.email} />
              <Field label="Phone" value={candidate.phoneRaw} />
              <Field label="LinkedIn" value={candidate.linkedinUrl} />
              <Field label="Source URL" value={candidate.rawPage.url} />
            </dl>
            <div className="mt-4">
              <Link href={candidate.rawPage.url} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-4 hover:underline">
                Open source page
              </Link>
            </div>
          </div>

          {candidate.contacts.length > 0 ? (
            <div className="rounded-xl border bg-card p-5">
              <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">All detected people</h2>
              <ul className="mt-3 space-y-2">
                {candidate.contacts.map((contact) => (
                  <li key={contact.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{contact.fullName}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{contact.confidence !== null ? `${Math.round(contact.confidence * 100)}% conf.` : ""}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{contact.jobTitle ?? "—"}</p>
                    <p className="mt-1 text-xs break-all">{[contact.email, contact.phone, contact.linkedinUrl].filter(Boolean).join(" · ") || "No contact info"}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <section className="mt-6 rounded-xl border bg-card p-5">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Field provenance</h2>
        {Object.keys(provenance).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No field provenance recorded.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Field</th>
                <th className="py-1.5 pr-4 font-medium">Value</th>
                <th className="py-1.5 pr-4 font-medium">Method</th>
                <th className="py-1.5 pr-4 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(provenance).map(([field, evidence]) => (
                <tr key={field} className="border-b last:border-0">
                  <td className="py-1.5 pr-4 font-mono text-xs align-top">{field}</td>
                  <td className="py-1.5 pr-4 break-all">{evidence.rejected ? <s>{evidence.value}</s> : evidence.value}</td>
                  <td className="py-1.5 pr-4 text-xs">{evidence.method ?? "—"}</td>
                  <td className="py-1.5 text-xs text-muted-foreground">
                    {evidence.evidenceType ?? "—"}
                    {evidence.rejected ? <span className="ml-2 text-destructive">rejected: {evidence.rejected}</span> : null}
                    {evidence.duplicate_of ? (
                      <span className="ml-2">
                        duplicate of{" "}
                        <Link href={`/lead-engine/candidates/${evidence.duplicate_of}`} className="text-primary underline-offset-4 hover:underline">
                          {evidence.duplicate_of.slice(-6)}
                        </Link>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Raw data</h2>
          <div className="mt-3">
            <JsonBlock data={rawData ?? {}} />
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Normalized data</h2>
          <div className="mt-3">
            <JsonBlock data={candidate.normalizedData ?? {}} />
          </div>
        </div>
      </section>
    </div>
  )
}
