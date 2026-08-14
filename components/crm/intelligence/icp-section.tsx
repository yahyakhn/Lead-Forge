import { humanize, rangeLabel, type ICPCriteria } from "@/lib/crm/icp-shared"

export interface IcpContext {
  id: string
  name: string
  description: string | null
  criteria: ICPCriteria
}

function Chips({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {values.map((value) => (
        <span
          key={value}
          className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
        >
          {value}
        </span>
      ))}
    </div>
  )
}

export function IcpSection({ icp }: { icp: IcpContext | null }) {
  if (!icp) return null
  const { criteria } = icp
  const locations = [
    ...criteria.countries,
    ...criteria.regions.map((r) => `${r} (region)`),
    ...criteria.cities.map((c) => `${c} (city)`),
  ]
  const exclusions = [
    ...criteria.exclusions.industries.map((v) => `ind: ${v}`),
    ...criteria.exclusions.countries.map((v) => `loc: ${v}`),
    ...criteria.exclusions.companyTypes.map((v) => `type: ${humanize(v)}`),
    ...criteria.exclusions.keywords.map((v) => `kw: ${v}`),
  ]

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">ICP Context</h2>
      <p className="text-sm">
        <span className="font-medium">{icp.name}</span>
        {icp.description ? (
          <span className="text-muted-foreground"> — {icp.description}</span>
        ) : null}
      </p>
      {criteria.industries.length === 0 &&
      locations.length === 0 &&
      !criteria.employeeRange &&
      !criteria.revenueRange &&
      criteria.technologies.length === 0 &&
      criteria.companyTypes.length === 0 &&
      criteria.signals.length === 0 &&
      !criteria.companyAge &&
      exclusions.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          This ICP has no criteria configured.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
          <Chips label="Industries" values={criteria.industries} />
          <Chips label="Locations" values={locations} />
          {criteria.employeeRange && (
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Employees:</span>
              <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs">
                {rangeLabel(criteria.employeeRange)}
              </span>
            </span>
          )}
          {criteria.revenueRange && (
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Revenue:</span>
              <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs">
                {rangeLabel(criteria.revenueRange)}{" "}
                {criteria.revenueRange.currency ?? "USD"}
              </span>
            </span>
          )}
          <Chips label="Technologies" values={criteria.technologies} />
          <Chips
            label="Company types"
            values={criteria.companyTypes.map(humanize)}
          />
          <Chips
            label="Target signals"
            values={criteria.signals.map(humanize)}
          />
          {criteria.companyAge && (
            <span className="flex items-baseline gap-2">
              <span className="text-xs text-muted-foreground">Age:</span>
              <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-xs">
                {rangeLabel(criteria.companyAge)} years
              </span>
            </span>
          )}
          <Chips label="Exclusions" values={exclusions} />
        </div>
      )}
    </section>
  )
}
