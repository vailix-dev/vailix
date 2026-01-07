import AsyncStorage from '@react-native-async-storage/async-storage';
import { createDecipheriv } from 'react-native-quick-crypto';
import { EventEmitter } from 'eventemitter3';
import type { StorageService } from './storage';
import type { Match, ReportMetadata } from './types';

const LAST_SYNC_KEY = 'vailix_last_sync';

interface ServerKey {
    rpi: string;
    metadata?: string;
    reportedAt: number;
}

export class MatcherService extends EventEmitter {
    constructor(
        private storage: StorageService,
        private downloadUrl: string,
        private appSecret: string
    ) { super(); }

    async fetchAndMatch(): Promise<Match[]> {
        try {
            let lastSync = parseInt(await AsyncStorage.getItem(LAST_SYNC_KEY) || '0', 10);
            const allMatches: Match[] = [];
            let maxReportedAt = lastSync;

            // Stream keys page by page to avoid OOM
            // Process each page immediately and discard from memory
            await this._downloadAndProcessKeys(lastSync, async (keys) => {
                if (keys.length === 0) return;

                // Track max timestamp for sync cursor
                const pageMax = Math.max(...keys.map(k => k.reportedAt));
                maxReportedAt = Math.max(maxReportedAt, pageMax);

                // Map for O(1) lookup
                const infectedMap = new Map<string, ServerKey>();
                for (const key of keys) infectedMap.set(key.rpi, key);

                // Match current batch against DB
                const infectedRpis = Array.from(infectedMap.keys());
                const matchingScans = await this.storage.getMatchingScans(infectedRpis);

                // Process matches
                for (const s of matchingScans) {
                    const serverKey = infectedMap.get(s.rpi)!;
                    const decryptedMetadata = this._decrypt(serverKey.metadata, s.metadataKey);

                    allMatches.push({
                        rpi: s.rpi,
                        timestamp: s.timestamp,
                        metadata: decryptedMetadata,
                        reportedAt: serverKey.reportedAt,
                    });
                }
            });

            // Update sync checkpoint only after successful processing
            if (maxReportedAt > lastSync) {
                await AsyncStorage.setItem(LAST_SYNC_KEY, maxReportedAt.toString());
            }

            if (allMatches.length > 0) {
                this.emit('match', allMatches);
            }

            await this.storage.cleanupOldScans();
            return allMatches;
        } catch (error) {
            this.emit('error', error);
            return [];
        }
    }

    private async _downloadAndProcessKeys(since: number, processor: (keys: ServerKey[]) => Promise<void>): Promise<void> {
        let cursor: string | null = null;

        do {
            const url = new URL(`${this.downloadUrl}/v1/download`);
            url.searchParams.set('since', since.toString());
            if (cursor) url.searchParams.set('cursor', cursor);
            url.searchParams.set('format', 'bin');

            const res = await fetch(url.toString(), {
                headers: { 'x-vailix-secret': this.appSecret },
            });

            if (!res.ok) throw new Error(`Server error: ${res.status}`);

            const buffer = await res.arrayBuffer();
            const keys = this._parseBinaryResponse(buffer);

            // Process chunk immediately
            await processor(keys);

            cursor = res.headers.get('x-vailix-next-cursor') || null;

            // Yield to event loop to free memory/prevent UI freeze
            await new Promise(resolve => setTimeout(resolve, 0));
        } while (cursor);
    }

    private _parseBinaryResponse(buffer: ArrayBuffer): ServerKey[] {
        const view = new DataView(buffer);
        const keys: ServerKey[] = [];
        let offset = 0;

        // Header: Count (4 bytes)
        if (buffer.byteLength < 4) return [];
        const count = view.getUint32(offset);
        offset += 4;

        for (let i = 0; i < count; i++) {
            // Bounds check: minimum key size is 16 (RPI) + 8 (timestamp) + 2 (metaLen) = 26 bytes
            if (offset + 26 > buffer.byteLength) {
                console.warn(`Binary response truncated at key ${i}/${count}`);
                break;
            }

            // RPI: 16 bytes (Bin) -> 32 hex chars
            const rpiBytes = new Uint8Array(buffer, offset, 16);
            const rpi = Array.from(rpiBytes).map(b => b.toString(16).padStart(2, '0')).join('');
            offset += 16;

            // Timestamp: 8 bytes (Double)
            const reportedAt = view.getFloat64(offset);
            offset += 8;

            // Metadata: Len (2 bytes) + Bytes
            const metaLen = view.getUint16(offset);
            offset += 2;

            let metadata: string | undefined = undefined;
            if (metaLen > 0) {
                // Bounds check for metadata
                if (offset + metaLen > buffer.byteLength) {
                    console.warn(`Binary response truncated during metadata at key ${i}/${count}`);
                    break;
                }
                const metaBytes = new Uint8Array(buffer, offset, metaLen);
                // TextDecoder correctly handles multi-byte UTF-8 (available in Hermes)
                metadata = new TextDecoder('utf-8').decode(metaBytes);
                offset += metaLen;
            }

            keys.push({ rpi, reportedAt, metadata });
        }
        return keys;
    }

    private _decrypt(encryptedStr: string | undefined | null, keyHex: string): ReportMetadata | undefined {
        if (!encryptedStr) return undefined;
        try {
            const parts = encryptedStr.split(':');
            if (parts.length !== 3) return undefined;

            const [ivB64, authTagB64, encryptedB64] = parts;
            const key = Buffer.from(keyHex, 'hex');
            const iv = Buffer.from(ivB64, 'base64');
            const authTag = Buffer.from(authTagB64, 'base64');

            const decipher = createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag as any);

            let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
            decrypted += decipher.final('utf8');

            return JSON.parse(decrypted);
        } catch (e) {
            console.warn('Failed to decrypt metadata', e);
            return undefined;
        }
    }
}
