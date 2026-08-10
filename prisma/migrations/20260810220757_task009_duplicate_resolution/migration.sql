-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('COMPANY', 'CONTACT');

-- CreateEnum
CREATE TYPE "MatchConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('AUTO_MATCH', 'REVIEW', 'NOT_MATCH');

-- CreateEnum
CREATE TYPE "DuplicateGroupStatus" AS ENUM ('PENDING_REVIEW', 'CONFIRMED', 'REJECTED', 'AUTO_MERGED');

-- CreateEnum
CREATE TYPE "DuplicateAuditAction" AS ENUM ('USER_CONFIRMED_DUPLICATE', 'USER_REJECTED_DUPLICATE', 'CANONICAL_SELECTED', 'AUTO_MERGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CandidateStatus" ADD VALUE 'DUPLICATE';
ALTER TYPE "CandidateStatus" ADD VALUE 'REVIEW';
ALTER TYPE "CandidateStatus" ADD VALUE 'READY';

-- AlterTable
ALTER TABLE "LeadCandidate" ADD COLUMN     "dataQualityScore" INTEGER,
ADD COLUMN     "normalizedCompanyName" TEXT,
ADD COLUMN     "normalizedPhone" TEXT,
ADD COLUMN     "qualityExplanation" JSONB,
ADD COLUMN     "qualityFlags" JSONB;

-- CreateTable
CREATE TABLE "EntityMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "candidateAId" TEXT NOT NULL,
    "candidateBId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "confidence" "MatchConfidence" NOT NULL,
    "reasons" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "status" "DuplicateGroupStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "confidence" INTEGER,
    "canonicalCandidateId" TEXT,
    "mergedData" JSONB,
    "conflicts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DuplicateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateGroupMember" (
    "id" TEXT NOT NULL,
    "duplicateGroupId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "matchScore" INTEGER,
    "matchReasons" JSONB,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateAuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "action" "DuplicateAuditAction" NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntityMatch_organizationId_status_idx" ON "EntityMatch"("organizationId", "status");

-- CreateIndex
CREATE INDEX "EntityMatch_organizationId_entityType_status_idx" ON "EntityMatch"("organizationId", "entityType", "status");

-- CreateIndex
CREATE INDEX "EntityMatch_organizationId_candidateAId_idx" ON "EntityMatch"("organizationId", "candidateAId");

-- CreateIndex
CREATE INDEX "EntityMatch_organizationId_candidateBId_idx" ON "EntityMatch"("organizationId", "candidateBId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityMatch_organizationId_candidateAId_candidateBId_key" ON "EntityMatch"("organizationId", "candidateAId", "candidateBId");

-- CreateIndex
CREATE INDEX "DuplicateGroup_organizationId_status_idx" ON "DuplicateGroup"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DuplicateGroup_organizationId_entityType_status_idx" ON "DuplicateGroup"("organizationId", "entityType", "status");

-- CreateIndex
CREATE INDEX "DuplicateGroup_organizationId_canonicalCandidateId_idx" ON "DuplicateGroup"("organizationId", "canonicalCandidateId");

-- CreateIndex
CREATE INDEX "DuplicateGroupMember_candidateId_idx" ON "DuplicateGroupMember"("candidateId");

-- CreateIndex
CREATE INDEX "DuplicateGroupMember_organizationId_idx" ON "DuplicateGroupMember"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DuplicateGroupMember_duplicateGroupId_candidateId_key" ON "DuplicateGroupMember"("duplicateGroupId", "candidateId");

-- CreateIndex
CREATE INDEX "DuplicateAuditEvent_organizationId_groupId_createdAt_idx" ON "DuplicateAuditEvent"("organizationId", "groupId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_normalizedCompanyName_idx" ON "LeadCandidate"("organizationId", "normalizedCompanyName");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_email_idx" ON "LeadCandidate"("organizationId", "email");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_normalizedPhone_idx" ON "LeadCandidate"("organizationId", "normalizedPhone");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_linkedinUrl_idx" ON "LeadCandidate"("organizationId", "linkedinUrl");

-- CreateIndex
CREATE INDEX "LeadCandidate_organizationId_dataQualityScore_idx" ON "LeadCandidate"("organizationId", "dataQualityScore");

-- AddForeignKey
ALTER TABLE "EntityMatch" ADD CONSTRAINT "EntityMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMatch" ADD CONSTRAINT "EntityMatch_candidateAId_fkey" FOREIGN KEY ("candidateAId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMatch" ADD CONSTRAINT "EntityMatch_candidateBId_fkey" FOREIGN KEY ("candidateBId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateGroup" ADD CONSTRAINT "DuplicateGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateGroup" ADD CONSTRAINT "DuplicateGroup_canonicalCandidateId_fkey" FOREIGN KEY ("canonicalCandidateId") REFERENCES "LeadCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateGroupMember" ADD CONSTRAINT "DuplicateGroupMember_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "DuplicateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateGroupMember" ADD CONSTRAINT "DuplicateGroupMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateGroupMember" ADD CONSTRAINT "DuplicateGroupMember_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateAuditEvent" ADD CONSTRAINT "DuplicateAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DuplicateAuditEvent" ADD CONSTRAINT "DuplicateAuditEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "DuplicateGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
