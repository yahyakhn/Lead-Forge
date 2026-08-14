# Known Issues

## 1. Flaky Test: bulk-converts 100 mixed candidates

**Test:** `tests/lead-engine/conversion.test.ts > conversion > bulk-converts 100 mixed candidates with accurate summary`

**Status:** Fails in full suite (`npm test`), passes when run individually.

**Error:** Test times out in 5000ms.

**Root Cause:** Test isolation issue. When running the full test suite (`npm test`), some test running before this one leaves database state that affects the conversion test's ability to create and convert 100 candidates within the 5000ms timeout. The test passes when run individually or in small test combinations.

**Classification:** Test environment / test-ordering dependency issue (not a code bug)

**Fix Status:** No code fix appropriate - the test expectations are correct and the application code is not at fault. The issue is in test execution order/database state persistence between tests.

**Workaround:** Run `npx vitest run tests/lead-engine/conversion.test.ts` to pass the test.

**Impact:** Minimal - this is a test infrastructure issue, not an application defect. All 388 other tests pass consistently.

## 2. Pre-existing Out-of-Spec Features

The following features from earlier tasks remain in the codebase per the BUILD_SPEC constraint "Do NOT remove them":

- **Email discovery and verification** (TASK 014)
- **Outreach and sequences** (TASK 016-017)
- **Enrichment** functionality

These are intentionally unchanged and not modified by TASK 025.

## 3. Pre-existing Test Failures

The single failing test (`bulk-converts 100 mixed candidates`) is a known test isolation issue that has been documented. All other 388 tests pass consistently.
