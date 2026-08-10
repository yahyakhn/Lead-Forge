-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('NOT_CONVERTED', 'READY', 'CONVERTED', 'SKIPPED', 'FAILED', 'NEEDS_REVIEW');

-- AlterEnum
ALTER TYPE "CandidateStatus" ADD VALUE 'CONVERTED';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceCandidateId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "source" TEXT,
ADD COLUMN     "sourceCandidateId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "sourceCandidateId" TEXT;

-- CreateTable
CREATE TABLE "LeadCandidateConversion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "companyId" TEXT,
    "contactId" TEXT,
    "leadId" TEXT,
    "status" "ConversionStatus" NOT NULL DEFAULT 'NOT_CONVERTED',
    "convertedById" TEXT,
    "convertedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCandidateConversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadCandidateConversion_candidateId_key" ON "LeadCandidateConversion"("candidateId");

-- CreateIndex
CREATE INDEX "LeadCandidateConversion_organizationId_status_idx" ON "LeadCandidateConversion"("organizationId", "status");

-- CreateIndex
CREATE INDEX "LeadCandidateConversion_organizationId_companyId_idx" ON "LeadCandidateConversion"("organizationId", "companyId");

-- CreateIndex
CREATE INDEX "LeadCandidateConversion_organizationId_contactId_idx" ON "LeadCandidateConversion"("organizationId", "contactId");

-- CreateIndex
CREATE INDEX "LeadCandidateConversion_organizationId_leadId_idx" ON "LeadCandidateConversion"("organizationId", "leadId");

-- CreateIndex
CREATE INDEX "LeadCandidateConversion_organizationId_convertedAt_idx" ON "LeadCandidateConversion"("organizationId", "convertedAt");

-- CreateIndex
CREATE INDEX "Company_organizationId_sourceCandidateId_idx" ON "Company"("organizationId", "sourceCandidateId");

-- CreateIndex
CREATE INDEX "Contact_organizationId_sourceCandidateId_idx" ON "Contact"("organizationId", "sourceCandidateId");

-- CreateIndex
CREATE INDEX "Lead_organizationId_source_idx" ON "Lead"("organizationId", "source");

-- CreateIndex
CREATE INDEX "Lead_organizationId_sourceCandidateId_idx" ON "Lead"("organizationId", "sourceCandidateId");

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "LeadCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCandidateConversion" ADD CONSTRAINT "LeadCandidateConversion_convertedById_fkey" FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
