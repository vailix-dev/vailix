# @vailix/mask

**Privacy-preserving proximity tracing SDK for React Native & Expo.**

Part of the **Vailix Core Framework**. This package handles:
- **Identity**: Rolling Proximity Identifier (RPI) generation/rotation.
- **BLE**: Broadcasting and scanning for nearby devices.
- **Matching**: Matching downloaded keys against local history.
- **Storage**: Securely storing keys and metadata.

## Installation

This package relies on several native modules which must be installed as **peer dependencies** in your application.

```bash
# 1. Install the SDK
npm install @vailix/mask

# 2. Install required native peer dependencies
npx expo install react-native-quick-crypto expo-secure-store expo-sqlite react-native-ble-plx
```

### Expo Configuration (`app.json`)

You must add the config plugin for BLE permissions:

```json
{
  "expo": {
    "plugins": [
      [
        "@config-plugins/react-native-ble-plx",
        {
          "isBackgroundEnabled": false,
          "modes": ["central", "peripheral"],
          "bluetoothAlwaysPermission": "Allow app to scan for nearby devices."
        }
      ]
    ]
  }
}
```

## Basic Usage

```typescript
import { VailixSDK } from '@vailix/mask';

// Initialize
const sdk = await VailixSDK.create({
  appSecret: "YOUR_SECRET",
  reportUrl: "https://your-drop-server.com",
  downloadUrl: "https://your-drop-server.com",
});

// Start Scanning
await sdk.startDiscovery();

// Listen for updates
const unsubscribe = sdk.onNearbyUsersChanged((users) => {
  console.log("Nearby:", users);
});
```

## Compatibility

- **Expo**: SDK 52+ (Development Build required, **Expo Go not supported**)
- **React Native**: 0.76+
