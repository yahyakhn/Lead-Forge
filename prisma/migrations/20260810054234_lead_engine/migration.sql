-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('WEB_SEARCH', 'WEBSITE', 'DIRECTORY', 'JOB_BOARD', 'SOCIAL_PUBLIC', 'PUBLIC_DATABASE', 'SITEMAP', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SourceCapability" AS ENUM ('DISCOVERY', 'SCRAPING', 'SEARCH', 'DIRECTORY', 'COMPANY_EXTRACTION', 'CONTACT_EXTRACTION', 'EMAIL_EXTRACTION');

-- CreateEnum
CREATE TYPE "ScraperRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScraperRunEventLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "LeadSource" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "LeadSourceType" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "capabilities" "SourceCapability"[],
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawLead" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalId" TEXT,
    "rawData" JSONB NOT NULL,
    "sourceUrl" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "icpId" TEXT,
    "status" "ScraperRunStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "recordsFound" INTEGER NOT NULL DEFAULT 0,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsDuplicate" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScraperRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScraperRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "level" "ScraperRunEventLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScraperRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSource_organizationId_type_idx" ON "LeadSource"("organizationId", "type");

-- CreateIndex
CREATE INDEX "LeadSource_organizationId_isActive_idx" ON "LeadSource"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "LeadSource_organizationId_createdAt_idx" ON "LeadSource"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSource_organizationId_slug_key" ON "LeadSource"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "RawLead_organizationId_sourceId_idx" ON "RawLead"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "RawLead_organizationId_runId_idx" ON "RawLead"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "RawLead_organizationId_externalId_idx" ON "RawLead"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "RawLead_organizationId_createdAt_idx" ON "RawLead"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawLead_organizationId_sourceId_externalId_key" ON "RawLead"("organizationId", "sourceId", "externalId");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_sourceId_idx" ON "ScraperRun"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_icpId_idx" ON "ScraperRun"("organizationId", "icpId");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_status_idx" ON "ScraperRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_createdAt_idx" ON "ScraperRun"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_startedAt_idx" ON "ScraperRun"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "ScraperRunEvent_runId_createdAt_idx" ON "ScraperRunEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "ScraperRunEvent_runId_level_idx" ON "ScraperRunEvent"("runId", "level");

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSource" ADD CONSTRAINT "LeadSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLead" ADD CONSTRAINT "RawLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLead" ADD CONSTRAINT "RawLead_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawLead" ADD CONSTRAINT "RawLead_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperRun" ADD CONSTRAINT "ScraperRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperRun" ADD CONSTRAINT "ScraperRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperRun" ADD CONSTRAINT "ScraperRun_icpId_fkey" FOREIGN KEY ("icpId") REFERENCES "ICPProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScraperRunEvent" ADD CONSTRAINT "ScraperRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
