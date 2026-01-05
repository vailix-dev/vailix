# @vailix/mask

Privacy-preserving proximity tracing SDK for React Native + Expo.

## Installation

```bash
npm install @vailix/mask
```

> **Note:** This package requires Expo Development Builds (not Expo Go) due to native dependencies.

```bash
npx expo prebuild
npx expo run:android  # or run:ios
```

**Required:** Add SQLCipher to your `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["expo-sqlite", { "useSQLCipher": true }]
    ]
  }
}
```

## Quick Start

```typescript
import { VailixSDK } from '@vailix/mask';

// Initialize SDK
const sdk = await VailixSDK.create({
  reportUrl: process.env.VAILIX_REPORT_URL!,
  downloadUrl: process.env.VAILIX_DOWNLOAD_URL!,
  appSecret: process.env.VAILIX_APP_SECRET!,
});

// Set up event handlers
const cleanup = sdk.onMatch((matches) => {
  console.log('Exposure detected:', matches);
});

// Start background sync
await sdk.matcher.fetchAndMatch();
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `reportUrl` | string | required | API endpoint for submitting reports |
| `downloadUrl` | string | required | API endpoint for downloading infected keys |
| `appSecret` | string | required | Shared secret for API authentication |
| `rpiDurationMs` | number | 900000 (15min) | How long each RPI persists. Use 86400000 (24h) for STD apps |
| `rescanIntervalMs` | number | 0 | Minimum time between scans of same RPI. 0 = no limit |
| `reportDays` | number | 14 | Days of history to upload when reporting |
| `keyStorage` | KeyStorage | SecureStore | Custom key storage adapter (for cloud backup) |

### Example Configuration

```typescript
const sdk = await VailixSDK.create({
  reportUrl: 'https://api.yourapp.com',
  downloadUrl: 'https://api.yourapp.com',
  appSecret: 'your-secret-key',
  rpiDurationMs: 24 * 60 * 60 * 1000,    // 24 hours
  rescanIntervalMs: 24 * 60 * 60 * 1000, // Block rescan for 24h
  reportDays: 14,
});
```

## Pairing Methods

Both methods result in **mutual notification** — if either user reports positive, the other is notified.

### NFC Pairing (Recommended)

Single tap to exchange identities:

```typescript
if (await VailixSDK.isNfcSupported()) {
  const result = await sdk.pairViaNfc();
  if (result.success) {
    console.log('Paired successfully');
  }
}
```

### QR Code Pairing (Fallback)

Both users must scan each other's QR code:

```typescript
// User A shows QR
const qrData = sdk.getQRCode();
// Display qrData as QR code

// User B scans
const success = await sdk.scanQR(scannedData);

// Then swap: B shows, A scans
```

## Reporting Positive

When a user tests positive:

```typescript
const success = await sdk.report(
  attestToken,  // Optional: Firebase App Check token
  {             // Optional: metadata (encrypted per-contact)
    condition: 'chlamydia',
    testDate: '2025-01-05',
  }
);
```

This uploads the user's last 14 days of RPIs (configurable via `reportDays`).

## Receiving Notifications

```typescript
// Subscribe to matches
const cleanup = sdk.onMatch((matches) => {
  for (const match of matches) {
    console.log('Exposure on:', new Date(match.timestamp));
    console.log('Reported at:', new Date(match.reportedAt));
    console.log('Details:', match.metadata); // Decrypted per-contact
  }
});

// Trigger sync (call this in background fetch)
await sdk.matcher.fetchAndMatch();

// Cleanup when component unmounts (React)
useEffect(() => {
  return sdk.onMatch(handler); // Returns cleanup function
}, []);
```

## Error Handling

```typescript
const cleanup = sdk.onError((error) => {
  console.error('SDK error:', error);
});
```

## Data Recovery

The SDK uses SQLCipher AES-256 encryption for all stored data. Recovery behavior depends on whether you implement `keyStorage`.

### Without keyStorage (Default)

Master key stored locally only. On reinstall:
- New master key generated → new identity
- Old scan history unreadable (wrong key)
- SDK automatically deletes corrupted database

### With keyStorage (Recommended)

Enable cross-device recovery by syncing the master key:

```typescript
// Custom storage for iCloud/Google Drive sync
// Recommended library: react-native-cloud-storage
import { CloudStorage } from 'react-native-cloud-storage';

const sdk = await VailixSDK.create({
  ...config,
  keyStorage: {
    getKey: () => CloudStorage.getItem('vailix_key'),
    setKey: (k) => CloudStorage.setItem('vailix_key', k),
  },
});
```

### User Experience Flow

1. **First install:** SDK generates key → `setKey()` saves to cloud
2. **Normal use:** Scans saved locally, OS backs up database
3. **Phone lost:** Key in cloud, database in iCloud/Google backup
4. **New phone:** User signs into same Apple ID/Google Account
5. **Reinstall:** SDK calls `getKey()` → returns existing key → opens database

**No user action required** except signing into the same cloud account.

### Recovery Scenarios

| Scenario | Master Key | Database | Result |
|----------|------------|----------|--------|
| Both recovered | ✅ From cloud | ✅ From backup | Full restore |
| Key only | ✅ From cloud | ❌ Empty | Fresh DB, can still report |
| New key, old DB | ❌ New | ⚠️ Wrong key | SDK deletes old DB, starts fresh |
| Neither | ❌ New | ❌ Empty | New identity |

### KeyStorage Interface

```typescript
interface KeyStorage {
  getKey(): Promise<string | null>;
  setKey(key: string): Promise<void>;
}
```

> [!IMPORTANT]
> The SDK does NOT require app-level login. Cloud sync uses device-level Apple ID / Google Account.

## API Reference

### VailixSDK

| Method | Description |
|--------|-------------|
| `VailixSDK.create(config)` | Initialize SDK |
| `VailixSDK.isNfcSupported()` | Check if device supports NFC |
| `sdk.getQRCode()` | Get QR code data for display |
| `sdk.scanQR(data)` | Scan and store another user's QR |
| `sdk.pairViaNfc()` | Pair via NFC tap |
| `sdk.report(token?, metadata?)` | Report positive |
| `sdk.onMatch(handler)` | Subscribe to exposure matches |
| `sdk.offMatch(handler)` | Unsubscribe from matches |
| `sdk.onError(handler)` | Subscribe to errors |
| `sdk.offError(handler)` | Unsubscribe from errors |
| `sdk.matcher.fetchAndMatch()` | Sync and check for matches |

### Match Object

```typescript
interface Match {
  rpi: string;           // The matched identifier
  timestamp: number;     // When the contact occurred
  metadata?: object;     // Decrypted reporter metadata
  reportedAt?: number;   // When the report was submitted
}
```

## License

MIT
