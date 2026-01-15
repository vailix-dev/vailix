---
"@vailix/drop": patch
---

Fix TypeScript build errors:
- Fix syntax error in routes.ts caused by corrupted comment
- Fix incorrect export in index.ts (KeyModel → createKeyModel)
- Add explicit type annotation for implicit any parameter
