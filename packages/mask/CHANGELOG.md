# @vailix/mask

## 0.2.6

### Patch Changes

- 36836bb: Fix BLE error handling: verify initialization, emit async errors properly, and add connection timeout.

## 0.2.5

### Patch Changes

- a48760e: Fix master key generation to use cryptographically secure random bytes

  Changed master key generation from `randomUUID()` to `randomBytes(32).toString('hex')`.
  This fixes the "Invalid master key format" error caused by UUID hyphens failing hex validation,
  and provides proper 256-bit cryptographic randomness following security best practices.

## 0.2.4

### Patch Changes

- dfda662: fix: make singleton initialization truly atomic
  - Fix race condition where check-and-set wasn't atomic by using IIFE pattern
  - Add comprehensive tests for singleton pattern (12 tests including stress test with 100 concurrent calls)

## 0.2.3

### Patch Changes

- c1ca263: fix: prevent race condition in SDK initialization
  - Implement singleton pattern for `VailixSDK.create()` to prevent concurrent database connections
  - Ensure database is properly closed before deletion on key mismatch errors
  - Add missing internal BLE types (`InternalNearbyUser`, `PendingPairRequest`, `BleServiceConfig`)
  - Add `VailixSDK.destroy()` for cleanup and `VailixSDK.isInitialized()` for status checking

## 0.2.2

### Patch Changes

- 4b6a9d5: fix: ensure database is closed before deletion on key mismatch and add missing internal types

## 0.2.1

### Patch Changes

- b3be912: docs: fix repository URLs and update README documentation

## 0.2.0

### Minor Changes

- BREAKING CHANGE: Moved native dependencies to `peerDependencies` and relaxed version constraints to (`>=`) to ensure broad compatibility with Expo updates.

## 0.1.3

### Patch Changes

- Widened Expo peer dependency range to ">=52.0.0" to support Expo SDK 54 and newer versions.

## 0.1.2

### Patch Changes

- Initial public publish

## 0.1.1

### Patch Changes

- Initial public release
