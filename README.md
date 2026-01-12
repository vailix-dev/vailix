# Vailix

Privacy-preserving proximity tracing framework.

## What is Vailix?

Vailix is an open-source framework for building **contact notification apps** with **privacy by design**. Use it for health alerts, event check-ins, networking apps, or any scenario where users need to be notified about past contacts.

**Key Features:**
- 🔒 **Privacy-first** — No central database of contacts
- 📱 **Mobile SDK** — React Native + Expo ready
- 🖥️ **Backend server** — Ready-to-deploy Fastify server
- 🔐 **Encryption** — Interaction-bound metadata encryption
- 📡 **NFC + QR** — Flexible pairing methods

## How It Works

```
1. Two users pair (NFC tap or QR scan)
   → Both store each other's anonymous ID locally

2. User reports positive
   → Uploads their anonymous IDs to server

3. Other users sync
   → Match found → Notification
```

**The server never knows who met whom.** Only anonymous, rotating identifiers are exchanged.

## Scalability & Performance

Vailix is engineered for high-scale environments (1M+ users):

- 🚀 **Binary Protocols** — RPIs stored as 16-byte buffers, saving 50% storage/RAM.
- ⚡ **Stream Processing** — Client syncs keys via chunked streams to prevent OOM.
- 📦 **Efficient Batching** — SQLite queries batched to respect OS limits.
- 🛡️ **SQLCipher Encryption** — High-performance AES-256 local storage.

## Packages

| Package | Description |
|---------|-------------|
| [@vailix/mask](./packages/mask) | Mobile SDK for React Native + Expo |
| [@vailix/drop](./packages/drop) | Backend server (Fastify) |

## Quick Start

### 1. Install SDK

```bash
npm install @vailix/mask
```

### 2. Initialize

```typescript
import { VailixSDK } from '@vailix/mask';

const sdk = await VailixSDK.create({
  reportUrl: process.env.VAILIX_REPORT_URL,
  downloadUrl: process.env.VAILIX_DOWNLOAD_URL,
  appSecret: process.env.VAILIX_APP_SECRET,
  rpiDurationMs: 24 * 60 * 60 * 1000, // 24h for STD apps
});
```

### 3. Pair Users

```typescript
// BLE discovery
if (await VailixSDK.isBleSupported()) {
  await sdk.startDiscovery();
  // Users appear in nearby list, tap to pair
  sdk.onNearbyUsersChanged((users) => {
    console.log('Nearby:', users);
  });
} else {
  // QR fallback: both users scan each other
  const qr = sdk.getQRCode();
  await sdk.scanQR(scannedData);
}
```

### 4. Report & Match

```typescript
// User reports positive
await sdk.report(attestToken, metadata);

// Other users sync and get notified
sdk.onMatch((matches) => {
  // Show notification
});
await sdk.matcher.fetchAndMatch();
```

## Configuration

See [.env.example](./.env.example) for all configuration options.

## Privacy & Data Recovery

Vailix uses SQLCipher AES-256 encryption for all stored data.

### With keyStorage (Recommended)

```typescript
// Enable cross-device recovery (e.g., via iCloud/Google Drive)
import { CloudStorage } from 'react-native-cloud-storage';

VailixSDK.create({
  keyStorage: {
    getKey: () => CloudStorage.getItem('vailix_key'),
    setKey: (k) => CloudStorage.setItem('vailix_key', k),
  },
});
```

| Data | Recovery |
|------|----------|
| Master key | ✅ Synced via iCloud/Google |
| Scan history | ✅ Restored from backup + decryptable |

**Full data recovery on new device.**

### Without keyStorage (Default)

| Data | Recovery |
|------|----------|
| Master key | ❌ Lost on uninstall |
| Scan history | ⚠️ Restored but **not decryptable** (wrong key) |

**New identity on reinstall.** Past scan history is unusable because the new master key cannot decrypt the old data.

> [!IMPORTANT]
> **If you need data recovery across devices/reinstalls, you must implement `keyStorage`.**
> See [SDK Documentation](./packages/mask/README.md) for more details.

## Documentation

- [SDK Documentation](./packages/mask/README.md)
- [Server Documentation](./packages/drop/README.md)

## Installation

**Mobile SDK (@vailix/mask)**
```bash
npm install @vailix/mask
# or
pnpm add @vailix/mask
```

**Server (@vailix/drop)**
```bash
npm install @vailix/drop
# or
pnpm add @vailix/drop
```

## Compatibility

| @vailix/mask | @vailix/drop | Notes |
|------------|------------|-------|
| v0.2.x     | v0.1.x     | Current |
| v0.1.x     | v0.1.x     | Initial Release |

### Peer Dependencies

The Mobile SDK requires:
- `react-native` >= 0.76.0
- `expo` ~52.0.0 (if using Expo)

> [!CAUTION]
> **Expo Prebuild Required**: `react-native-quick-crypto` contains native code and will NOT work with Expo Go. You must use Expo Development Builds.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## Security

For security issues, please see [SECURITY.md](./SECURITY.md).

## License

MIT
