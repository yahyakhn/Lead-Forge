# LeadForge

Internal lead-generation CRM for a startup: find qualified prospects, research
them, score them, and move them into the sales pipeline.

Built as a modular monolith — an internal tool first, with a clean enough
baseline (multi-organization columns, adapter-based scraping/AI) to
commercialize later.

## Status

Task 001 (project foundation) is complete: Next.js, TypeScript (strict),
Tailwind, shadcn/ui, PostgreSQL, Prisma, Docker Compose, ESLint, Prettier,
Vitest, health endpoint. No CRM functionality yet.

## Requirements

- Node.js 20.19+ (22.x recommended)
- npm
- Docker Desktop (or any Docker + Compose v2)

## Installation

```bash
npm install
cp .env.example .env
docker compose up -d
npm run db:generate
npm run db:push
```

## Environment variables

See `.env.example`. Key values:

| Variable       | Purpose                                 |
| -------------- | --------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string            |
| `REDIS_URL`    | Redis for background jobs (later tasks) |
| `AI_PROVIDER`  | `deepseek` / mock (later tasks)         |
| `AI_MODEL`     | Model name (later tasks)                |
| `AI_API_KEY`   | Provider key (later tasks)              |
| `AUTH_SECRET`  | Session secret (later tasks)            |
| `APP_URL`      | Public app URL                          |

Never commit real secrets — `.env` is gitignored.

## Database setup

Docker Compose runs PostgreSQL 16 (`localhost:5432`, default
user/password/db `leadforge`). Redis joins compose with the scraper queue task.

```bash
docker compose ps          # both services should be "healthy"
npm run db:generate        # generate Prisma Client into /generated/prisma
npm run db:push            # sync schema (adds models in later tasks)
npm run db:studio          # browsable DB UI
```

Prisma 7 requires the driver adapter (`@prisma/adapter-pg`) and
`prisma.config.ts`; both are configured. Run `prisma generate` explicitly
after schema changes (it no longer runs automatically).

## Running locally

```bash
npm run dev        # http://localhost:3000
```

- `http://localhost:3000/` — landing page
- `http://localhost:3000/api/health` — JSON health endpoint (`200`/`503`)

## Running tests

```bash
npm run test        # single run
npm run test:watch  # watch mode
```

## Running workers / scrapers

Not yet implemented — incoming in later tasks (BullMQ on Redis).

## Checks

```bash
npm run lint        # ESLint
npm run format:check / format
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Architecture

Modular monolith (spec: `BUILD_SPEC.md`). Planned modules: CRM, Lead Engine
(discovery → scraping → normalization → deduplication → scoring), Analytics.
Scraping is adapter-based (Crawlee/Playwright/HTTP) and runs as async jobs;
AI sits behind an abstraction layer with a mock provider for tests. The CRM
must work fully without AI or scrapers.

## Security

Credential-free config via environment variables. SSRF protection for the
scraper and file-upload validation are planned (see spec §37). Only scrape
sources the user is permitted to access (spec §18).

## Development workflow

Follow `BUILD_SPEC.md` tasks in order. Each task: inspect → smallest complete
change → tests → typecheck → lint → tests → fix failures → summarize. Never
rewrite working components without a strong reason; no new dependencies
unless necessary.
