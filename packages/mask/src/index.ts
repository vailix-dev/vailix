import { createCipheriv, randomBytes } from 'react-native-quick-crypto';
import { IdentityManager } from './identity';
import { StorageService } from './storage';
import { MatcherService } from './matcher';
import { NfcService } from './nfc';
import { formatQR, parseQR } from './transport';
import { initializeDatabase } from './db';
import type { Match, MatchHandler, ReportMetadata, KeyStorage } from './types';

export class VailixSDK {
    public identity: IdentityManager;
    public storage: StorageService;
    public matcher: MatcherService;
    private reportUrl: string;
    private appSecret: string;
    private reportDays: number;

    private constructor(
        identity: IdentityManager,
        storage: StorageService,
        matcher: MatcherService,
        reportUrl: string,
        appSecret: string,
        reportDays: number
    ) {
        this.identity = identity;
        this.storage = storage;
        this.matcher = matcher;
        this.reportUrl = reportUrl;
        this.appSecret = appSecret;
        this.reportDays = reportDays;
    }

    /**
     * @param config.reportUrl The live API endpoint for submitting reports
     * @param config.downloadUrl The endpoint for downloading keys (can be the same as reportUrl or a CDN)
     * @param config.rpiDurationMs How long RPI persists (default: 15min, can be 24h for STD apps)
     * @param config.rescanIntervalMs Minimum time between scans of same RPI (default: 0 = no limit)
     * @param config.keyStorage Custom key storage adapter (default: expo-secure-store)
     */
    static async create(config: {
        reportUrl: string;
        downloadUrl: string;
        appSecret: string;
        rpiDurationMs?: number;
        rescanIntervalMs?: number;
        reportDays?: number;
        keyStorage?: KeyStorage;
    }): Promise<VailixSDK> {
        // Validate: rescanInterval cannot exceed rpiDuration
        const rpiDuration = config.rpiDurationMs ?? 15 * 60 * 1000; // Default 15 min
        if (config.rescanIntervalMs && config.rescanIntervalMs > rpiDuration) {
            throw new Error(`rescanIntervalMs (${config.rescanIntervalMs}) cannot exceed rpiDurationMs (${rpiDuration})`);
        }

        // Initialize identity first to get master key for database encryption
        const identity = new IdentityManager({
            rpiDurationMs: config.rpiDurationMs,
            keyStorage: config.keyStorage,
        });
        await identity.initialize();

        // Initialize encrypted database (SQLCipher) using master key
        const masterKey = identity.getMasterKey();
        const db = await initializeDatabase(masterKey);

        const storage = new StorageService(db, {
            rescanIntervalMs: config.rescanIntervalMs
        });
        await storage.initialize();  // Load persisted scan history

        const matcher = new MatcherService(storage, config.downloadUrl, config.appSecret);

        // Cleanup old scans on init
        await storage.cleanupOldScans();

        return new VailixSDK(identity, storage, matcher, config.reportUrl, config.appSecret, config.reportDays ?? 14);
    }

    // Get current QR code data
    getQRCode(): string {
        const rpi = this.identity.getCurrentRPI();
        const metaKey = this.identity.getMetadataKey(rpi);
        return formatQR(rpi, metaKey);
    }

    // Scan another user's QR code and log it
    // Returns false if: QR invalid, expired (>RPI duration), rescan blocked, or error
    async scanQR(qrData: string): Promise<boolean> {
        try {
            const parsed = parseQR(qrData);
            if (!parsed) return false;

            // SECURITY: Reject QR codes older than 15 minutes to prevent replay attacks
            const MAX_QR_AGE_MS = 15 * 60 * 1000;
            if (Date.now() - parsed.timestamp > MAX_QR_AGE_MS) {
                return false; // Expired QR
            }

            // Check rescan protection (returns false if scanned too recently)
            if (!this.storage.canScan(parsed.rpi)) {
                return false; // Rescan blocked
            }

            await this.storage.logScan(parsed.rpi, parsed.metadataKey, Date.now());
            return true;
        } catch (error) {
            this.matcher.emit('error', error);
            return false;
        }
    }

    // NFC Support: Check if device supports NFC
    static async isNfcSupported(): Promise<boolean> {
        return NfcService.isSupported();
    }

    // NFC Pairing: Bidirectional exchange via NFC tap
    // Both devices store each other's RPI for mutual notification
    async pairViaNfc(): Promise<{ success: boolean; partnerRpi?: string }> {
        try {
            const nfc = new NfcService();
            const supported = await nfc.initialize();
            if (!supported) {
                return { success: false };
            }

            const myRpi = this.identity.getCurrentRPI();
            const myMetaKey = this.identity.getMetadataKey(myRpi);

            const result = await nfc.pair(myRpi, myMetaKey);
            nfc.cleanup();

            if (result.success && result.partnerRpi && result.partnerMetadataKey) {
                // Check rescan protection (consistent with scanQR behavior)
                if (!this.storage.canScan(result.partnerRpi)) {
                    return { success: false }; // Already paired recently
                }

                // Store partner's RPI locally
                await this.storage.logScan(result.partnerRpi, result.partnerMetadataKey, Date.now());
                return { success: true, partnerRpi: result.partnerRpi };
            }

            return { success: false };
        } catch (error) {
            this.matcher.emit('error', error);
            return { success: false };
        }
    }

    // Report positive (upload configured days of history)
    // attestToken: optional attestation token (e.g., Firebase App Check)
    // metadata: app-specific data (e.g., STD type, test date). If null, a generic positive is reported.
    async report(
        attestToken?: string,
        metadata?: ReportMetadata
    ): Promise<boolean> {
        try {
            const keys = this.identity.getHistory(this.reportDays);

            // Encrypt metadata individually for each key in history
            const reports = keys.map(rpi => ({
                rpi,
                encryptedMetadata: this._encrypt(metadata, this.identity.getMetadataKey(rpi))
            }));

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'x-vailix-secret': this.appSecret,
            };
            if (attestToken) {
                headers['x-attest-token'] = attestToken;
            }
            const res = await fetch(`${this.reportUrl}/v1/report`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ reports }),
            });
            return res.ok;
        } catch (error) {
            this.matcher.emit('error', error);
            return false;
        }
    }

    // Encryption Helpers
    // Max metadata size: 8KB (leaves headroom under 64KB binary format limit)
    private static readonly MAX_METADATA_SIZE = 8 * 1024;

    private _encrypt(metadata: ReportMetadata | undefined, keyHex: string): string {
        if (!metadata) return '';

        const jsonStr = JSON.stringify(metadata);
        if (jsonStr.length > VailixSDK.MAX_METADATA_SIZE) {
            throw new Error(`Metadata exceeds maximum size of ${VailixSDK.MAX_METADATA_SIZE} bytes`);
        }

        const key = Buffer.from(keyHex, 'hex');
        const iv = randomBytes(12); // 96-bit IV for GCM
        const cipher = createCipheriv('aes-256-gcm', key, iv);

        let encrypted = cipher.update(jsonStr, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const authTag = cipher.getAuthTag().toString('base64');

        // Format: iv:authTag:encryptedData
        return `${iv.toString('base64')}:${authTag}:${encrypted}`;
    }



    // Event handlers - return cleanup function for React useEffect compatibility
    onMatch(handler: MatchHandler): () => void {
        this.matcher.on('match', handler);
        return () => this.matcher.off('match', handler);
    }

    onError(handler: (error: Error) => void): () => void {
        this.matcher.on('error', handler);
        return () => this.matcher.off('error', handler);
    }

    // Explicit cleanup methods (alternative API)
    offMatch(handler: MatchHandler): void {
        this.matcher.off('match', handler);
    }

    offError(handler: (error: Error) => void): void {
        this.matcher.off('error', handler);
    }
}

export { formatQR, parseQR };
export type { Match, MatchHandler, ReportMetadata, KeyStorage };
