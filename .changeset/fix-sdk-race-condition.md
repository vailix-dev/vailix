---
"@vailix/mask": patch
---

fix: make singleton initialization truly atomic

- Fix race condition where check-and-set wasn't atomic by using IIFE pattern
- Add comprehensive tests for singleton pattern (12 tests including stress test with 100 concurrent calls)

