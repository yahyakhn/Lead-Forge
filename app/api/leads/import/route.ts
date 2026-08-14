import { NextResponse } from "next/server"
import { withOrg, parseJson } from "@/lib/crm/http"
import { z } from "zod"
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  previewCsvImport,
  importCsvRows,
} from "@/lib/lead-engine/csv/service"

const importSchema = z.object({
  csv: z.string().min(1).max(CSV_MAX_BYTES),
  mapping: z.record(z.string(), z.string()),
  strategy: z.enum(["CREATE", "SKIP", "UPDATE"]).default("CREATE"),
  confirm: z.boolean().default(false),
})

// POST /api/leads/import — body: { csv, mapping, strategy, confirm? }
// Without confirm: preview (row statuses + sample). With confirm: import.
export const POST = withOrg(async ({ orgId }, request) => {
  const { csv, mapping, strategy, confirm } = await parseJson(importSchema, request)
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length - 1 > CSV_MAX_ROWS) {
    return NextResponse.json({ error: `CSV exceeds the ${CSV_MAX_ROWS.toLocaleString()} row limit` }, { status: 400 })
  }
  const result = confirm
    ? await importCsvRows(orgId, csv, mapping, strategy)
    : await previewCsvImport(orgId, csv, mapping)
  return NextResponse.json(result)
})