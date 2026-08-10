-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceCandidateId_fkey" FOREIGN KEY ("sourceCandidateId") REFERENCES "LeadCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
