-- AlterTable
ALTER TABLE "ScraperRun" ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagesFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagesQueued" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pagesSucceeded" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RawPage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER,
    "errorCategory" TEXT,
    "title" TEXT,
    "contentType" TEXT,
    "html" TEXT,
    "textContent" TEXT,
    "metadata" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawPage_organizationId_runId_idx" ON "RawPage"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "RawPage_organizationId_sourceId_idx" ON "RawPage"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "RawPage_organizationId_url_idx" ON "RawPage"("organizationId", "url");

-- CreateIndex
CREATE INDEX "RawPage_organizationId_statusCode_idx" ON "RawPage"("organizationId", "statusCode");

-- CreateIndex
CREATE INDEX "RawPage_organizationId_createdAt_idx" ON "RawPage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ScraperRun_organizationId_status_heartbeatAt_idx" ON "ScraperRun"("organizationId", "status", "heartbeatAt");

-- AddForeignKey
ALTER TABLE "RawPage" ADD CONSTRAINT "RawPage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPage" ADD CONSTRAINT "RawPage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPage" ADD CONSTRAINT "RawPage_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
