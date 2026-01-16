---
"@vailix/mask": patch
---

Fix master key generation to use cryptographically secure random bytes

Changed master key generation from `randomUUID()` to `randomBytes(32).toString('hex')`.
This fixes the "Invalid master key format" error caused by UUID hyphens failing hex validation,
and provides proper 256-bit cryptographic randomness following security best practices.
