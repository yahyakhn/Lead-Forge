export interface PageResult<T> {
  data: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 100

export function parsePagination(
  sp: { page?: number | string | string[]; pageSize?: number | string | string[] },
): { page: number; pageSize: number } {
  const page = finitePositive(Number(sp.page)) ? Number(sp.page) : 1
  const rawSize = Number(sp.pageSize)
  const pageSize = Number.isFinite(rawSize)
    ? Math.min(Math.max(Math.trunc(rawSize), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE
  return { page, pageSize }
}

function finitePositive(n: number): boolean {
  return Number.isFinite(n) && n >= 1
}