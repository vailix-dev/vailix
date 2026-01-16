---
"@vailix/mask": patch
---

Fix BLE error handling:
- Verify BLE initialization before scanning with 5s timeout
- Emit async scan errors via EventEmitter pattern
- Handle transient BLE states (Unknown/Resetting) on Android by waiting for stable state
- Add Unsupported to terminal failure states
