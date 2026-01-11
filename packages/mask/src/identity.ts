import { createHmac, randomUUID } from 'react-native-quick-crypto';
import * as SecureStore from 'expo-secure-store';
import type { KeyStorage } from './types';

const MASTER_KEY_STORE = 'vailix_master_key';
const DEFAULT_EPOCH_MS = 15 * 60 * 1000; // 15 minutes default

// Default key storage using expo-secure-store (device-only)
class DefaultKeyStorage implements KeyStorage {
    async getKey(): Promise<string | null> {
        return SecureStore.getItemAsync(MASTER_KEY_STORE);
    }
    async setKey(key: string): Promise<void> {
        await SecureStore.setItemAsync(MASTER_KEY_STORE, key);
    }
}

export class IdentityManager {
    private masterKey: string | null = null;
    private epochMs: number;
    private keyStorage: KeyStorage;

    constructor(config: { rpiDurationMs?: number; keyStorage?: KeyStorage } = {}) {
        this.epochMs = config.rpiDurationMs ?? DEFAULT_EPOCH_MS;
        this.keyStorage = config.keyStorage ?? new DefaultKeyStorage();
    }

    async initialize(): Promise<void> {
        try {
            let key = await this.keyStorage.getKey();
            if (!key) {
                key = randomUUID();
                await this.keyStorage.setKey(key);
            }
            this.masterKey = key;
        } catch (error) {
            throw new Error(`Failed to initialize identity: ${error}`);
        }
    }

    getCurrentRPI(): string {
        if (!this.masterKey) throw new Error('Not initialized');
        return this._generateRPI(Math.floor(Date.now() / this.epochMs));
    }

    // Get RPI history for the past N days
    // Note: Synchronous HMAC computation. For STD apps (24h RPI) = 14 calls.
    // For contact tracing (15min RPI) = 1,344 calls - acceptable on modern devices.
    getHistory(days: number): string[] {
        if (!this.masterKey) throw new Error('Not initialized');
        const epochsPerDay = (24 * 60 * 60 * 1000) / this.epochMs;
        const currentEpoch = Math.floor(Date.now() / this.epochMs);
        return Array.from({ length: days * epochsPerDay }, (_, i) =>
            this._generateRPI(currentEpoch - i)
        );
    }

    // Generate 128-bit Rolling Proximity Identifier (RPI) for the given epoch.
    private _generateRPI(epoch: number): string {
        return createHmac('sha256', this.masterKey!)
            .update(epoch.toString())
            .digest('hex')
            .substring(0, 32);
    }

    // Generate a key specifically for encrypting metadata for an RPI
    getMetadataKey(rpi: string): string {
        if (!this.masterKey) throw new Error('Not initialized');
        return createHmac('sha256', this.masterKey!)
            .update(`meta:${rpi}`)
            .digest('hex')
            .substring(0, 64); // 32 bytes for AES-256
    }

    // Get master key for database encryption (SQLCipher)
    getMasterKey(): string {
        if (!this.masterKey) throw new Error('Not initialized');
        return this.masterKey;
    }

    /**
     * Get anonymous display name derived from current RPI.
     * Used for showing user's identity in UI without revealing master key.
     * Format: "User-abc12" (RPI prefix)
     */
    getDisplayName(): string {
        const rpi = this.getCurrentRPI();
        return `User-${rpi.substring(0, 5)}`;
    }
}
