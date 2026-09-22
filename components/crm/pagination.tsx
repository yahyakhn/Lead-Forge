import { Button } from "@/components/ui/button"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

function pageHref(pathname: string, params: Record<string, string | string[] | undefined>, param: string, page: number) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key === param) continue
    if (Array.isArray(value)) for (const v of value) search.append(key, v)
    else if (value !== undefined) search.append(key, value)
  }
  if (page > 1) search.set(param, String(page))
  const qs = search.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function Pagination({
  pathname,
  params,
  param = "page",
  page,
  totalPages,
  total,
}: {
  pathname: string
  params: Record<string, string | string[] | undefined>
  param?: string
  page: number
  totalPages: number
  total: number
}) {
  if (totalPages <= 1) return null
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-muted-foreground">
        {total.toLocaleString()} total · page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <Button
          render={
            <a
              aria-disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-50" : undefined}
              href={pageHref(pathname, params, param, page - 1)}
            />
          }
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
        >
          <ChevronLeftIcon />
        </Button>
        {pages.map((p) => {
          const variant = p === page ? "secondary" : "ghost"
          return (
            <Button key={p} render={<a href={pageHref(pathname, params, param, p)} />} variant={variant as "secondary" | "ghost"} size="icon-sm" className="text-xs" nativeButton={false}>
              {p}
            </Button>
          )
        })}
        <Button
          render={
            <a
              aria-disabled={page >= totalPages}
              className={page >= totalPages ? "pointer-events-none opacity-50" : undefined}
              href={pageHref(pathname, params, param, page + 1)}
            />
          }
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}