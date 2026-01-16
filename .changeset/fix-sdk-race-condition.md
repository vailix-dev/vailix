---
"@vailix/mask": patch
---

fix: prevent race condition in SDK initialization

- Implement singleton pattern for `VailixSDK.create()` to prevent concurrent database connections
- Ensure database is properly closed before deletion on key mismatch errors
- Add missing internal BLE types (`InternalNearbyUser`, `PendingPairRequest`, `BleServiceConfig`)
- Add `VailixSDK.destroy()` for cleanup and `VailixSDK.isInitialized()` for status checking
