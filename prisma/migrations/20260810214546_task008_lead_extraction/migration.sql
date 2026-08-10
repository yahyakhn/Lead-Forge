-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('PENDING', 'PROCESSING', 'EXTRACTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ExtractionMethod" AS ENUM ('DETERMINISTIC', 'AI', 'HYBRID');

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scraperRunId" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
    "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
    "pagesFailed" INTEGER NOT NULL DEFAULT 0,
    "candidatesCreated" INTEGER NOT NULL DEFAULT 0,
    "aiCalls" INTEGER NOT NULL DEFAULT 0,
    "aiFailures" INTEGER NOT NULL DEFAULT 0,
    "aiInputChars" INTEGER NOT NULL DEFAULT 0,
    "aiOutputChars" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCandidate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "rawPageId" TEXT NOT NULL,
    "pageClassification" TEXT,
    "status" "CandidateStatus" NOT NULL DEFAULT 'PENDING',
    "extractionMethod" "ExtractionMethod",
    "extractionConfidence" DOUBLE PRECISION,
    "extractionVersion" TEXT NOT NULL DEFAULT '1',
    "contentHash" TEXT,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "companyDomain" TEXT,
    "websiteUrl" TEXT,
    "description" TEXT,
    "industry" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "logoUrl" TEXT,
    "contactFullName" TEXT,
    "contactFirstName" TEXT,
    "contactLastName" TEXT,
    "contactJobTitle" TEXT,
    "email" TEXT,
    "phoneRaw" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "socialLinks" JSONB,
    "jobs" JSONB,
    "fieldProvenance" JSONB,
    "fieldConfidence" JSONB,
    "rawData" JSONB,
    "normalizedData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateContact" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "confidence" DOUBLE PRECISION,
    "provenance" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionRun_scraperRunId_key" ON "ExtractionRun"("scraperRunId");

-- CreateIndex
CREATE INDEX "ExtractionRun_organizationId_status_idx" ON "ExtractionRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ExtractionRun_organizationId_createdAt_idx" ON "ExtractionRun"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionRun_organizationId_scraperRunId_key" ON "ExtractionRun"("organizationId", "scraperRunId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCandidate_rawPageId_key" ON "LeadCandidate"("rawPageId");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_status_idx" ON "LeadCandidate"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_runId_idx" ON "LeadCandidate"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_sourceId_idx" ON "LeadCandidate"("organizationId", "sourceId");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_companyDomain_idx" ON "LeadCandidate"("organizationId", "companyDomain");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_extractionMethod_idx" ON "LeadCandidate"("organizationId", "extractionMethod");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_contentHash_idx" ON "LeadCandidate"("organizationId", "contentHash");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_createdAt_idx" ON "LeadCandidate"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCandidate_organizationId_rawPageId_key" ON "LeadCandidate"("organizationId", "rawPageId");

-- CreateIndex
CREATE INDEX "CandidateContact_candidateId_idx" ON "CandidateContact"("candidateId");

-- CreateIndex
CREATE INDEX "CandidateContact_organizationId_email_idx" ON "CandidateContact"("organizationId", "email");

-- CreateIndex
CREATE INDEX "CandidateContact_organizationId_fullName_idx" ON "CandidateContact"("organizationId", "fullName");

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_scraperRunId_fkey" FOREIGN KEY ("scraperRunId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidate" ADD CONSTRAINT "LeadCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidate" ADD CONSTRAINT "LeadCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScraperRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidate" ADD CONSTRAINT "LeadCandidate_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "LeadSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidate" ADD CONSTRAINT "LeadCandidate_rawPageId_fkey" FOREIGN KEY ("rawPageId") REFERENCES "RawPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateContact" ADD CONSTRAINT "CandidateContact_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateContact" ADD CONSTRAINT "CandidateContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
