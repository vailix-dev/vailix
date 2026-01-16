import { createCipheriv, randomBytes } from 'react-native-quick-crypto';
import { IdentityManager } from './identity';
import { StorageService } from './storage';
import { MatcherService } from './matcher';
import { BleService } from './ble';
import { formatQR, parseQR } from './transport';
import { initializeDatabase } from './db';
import type {
    Match,
    MatchHandler,
    ReportMetadata,
    KeyStorage,
    VailixConfig,
    NearbyUser,
    PairResult
} from './types';

export class VailixSDK {
    // Singleton instance and initialization promise for thread-safety
    private static instance: VailixSDK | null = null;
    private static initPromise: Promise<VailixSDK> | null = null;

    public identity: IdentityManager;
    public storage: StorageService;
    public matcher: MatcherService;
    private ble: BleService;
    private reportUrl: string;
    private appSecret: string;
    private reportDays: number;
    private rpiDurationMs: number;

    private constructor(
        identity: IdentityManager,
        storage: StorageService,
        matcher: MatcherService,
        ble: BleService,
        reportUrl: string,
        appSecret: string,
        reportDays: number,
        rpiDurationMs: number
    ) {
        this.identity = identity;
        this.storage = storage;
        this.matcher = matcher;
        this.ble = ble;
        this.reportUrl = reportUrl;
        this.appSecret = appSecret;
        this.reportDays = reportDays;
        this.rpiDurationMs = rpiDurationMs;
    }

    /**
     * Create or return the singleton SDK instance.
     * 
     * Thread-safe: concurrent calls will wait for the first initialization to complete
     * and return the same instance. Config is only used on first initialization.
     * 
     * @param config - Unified configuration object (used only on first call)
     */
    static async create(config: VailixConfig): Promise<VailixSDK> {
        // Already initialized - return existing instance
        if (VailixSDK.instance) {
            return VailixSDK.instance;
        }

        // Initialization in progress - wait for it
        if (VailixSDK.initPromise) {
            return VailixSDK.initPromise;
        }

        // CRITICAL: Set promise SYNCHRONOUSLY before any await
        // This makes the check-and-set atomic within the same microtask
        VailixSDK.initPromise = (async () => {
            try {
                const sdk = await VailixSDK.doCreate(config);
                VailixSDK.instance = sdk;
                return sdk;
            } catch (error) {
                // Clear promise on failure so retry is possible
                VailixSDK.initPromise = null;
                throw error;
            }
        })();

        return VailixSDK.initPromise;
    }

    /**
     * Internal initialization logic (extracted for singleton pattern).
     */
    private static async doCreate(config: VailixConfig): Promise<VailixSDK> {
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

        // Initialize BLE service with config options
        const ble = new BleService({
            discoveryTimeoutMs: config.bleDiscoveryTimeoutMs,
            proximityThreshold: config.proximityThreshold,
            autoAccept: config.autoAcceptIncomingPairs,
            serviceUUID: config.serviceUUID,
        });
        ble.setStorage(storage);

        // Forward BLE errors to SDK error stream
        // Consumers receive via sdk.onError()
        ble.on('error', (error) => {
            matcher.emit('error', error);
        });

        // Cleanup old scans on init
        await storage.cleanupOldScans();

        return new VailixSDK(
            identity,
            storage,
            matcher,
            ble,
            config.reportUrl,
            config.appSecret,
            config.reportDays ?? 14,
            rpiDuration
        );
    }

    /**
     * Destroy the singleton instance and release all resources.
     * Use for testing or when the app needs to fully reset the SDK.
     */
    static async destroy(): Promise<void> {
        if (VailixSDK.instance) {
            // Cleanup BLE resources
            VailixSDK.instance.ble.destroy();
            // Note: Database connection cleanup is handled by expo-sqlite
            VailixSDK.instance = null;
        }
        VailixSDK.initPromise = null;
    }

    /**
     * Check if the SDK has been initialized.
     */
    static isInitialized(): boolean {
        return VailixSDK.instance !== null;
    }

    // ========================================================================
    // QR Code Methods
    // ========================================================================

    /** Get current QR code data */
    getQRCode(): string {
        const rpi = this.identity.getCurrentRPI();
        const metaKey = this.identity.getMetadataKey(rpi);
        return formatQR(rpi, metaKey);
    }

    /**
     * Scan another user's QR code and log it.
     * Returns false if: QR invalid, expired (>RPI duration), rescan blocked, or error
     */
    async scanQR(qrData: string): Promise<boolean> {
        try {
            const parsed = parseQR(qrData);
            if (!parsed) return false;

            // Reject QR codes older than RPI duration (QR is only valid while RPI is valid)
            if (Date.now() - parsed.timestamp > this.rpiDurationMs) {
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

    // ========================================================================
    // BLE Discovery & Pairing Methods
    // ========================================================================

    /**
     * Check if BLE is supported on this device.
     */
    static async isBleSupported(): Promise<boolean> {
        return BleService.isSupported();
    }

    /**
     * Start BLE discovery (call when pairing screen opens).
     * Begins advertising our RPI and scanning for nearby users.
     */
    async startDiscovery(): Promise<void> {
        const rpi = this.identity.getCurrentRPI();
        const metaKey = this.identity.getMetadataKey(rpi);
        await this.ble.startDiscovery(rpi, metaKey);
    }

    /**
     * Stop BLE discovery (call when leaving pairing screen).
     */
    async stopDiscovery(): Promise<void> {
        await this.ble.stopDiscovery();
    }

    /**
     * Get current list of nearby users.
     */
    getNearbyUsers(): NearbyUser[] {
        return this.ble.getNearbyUsers();
    }

    /**
     * Subscribe to nearby user updates.
     * Returns cleanup function for React useEffect compatibility.
     * 
     * @example
     * useEffect(() => {
     *   const cleanup = sdk.onNearbyUsersChanged(setNearbyUsers);
     *   return cleanup;
     * }, []);
     */
    onNearbyUsersChanged(callback: (users: NearbyUser[]) => void): () => void {
        return this.ble.onNearbyUsersChanged(callback);
    }

    /**
     * Pair with a specific user (one-tap action).
     * In explicit consent mode, this also accepts pending incoming requests.
     * 
     * @param userId - The user's ID from NearbyUser.id
     */
    async pairWithUser(userId: string): Promise<PairResult> {
        return this.ble.pairWithUser(userId);
    }

    /**
     * Unpair with a user (removes from storage and resets status).
     * Useful for "undo" functionality or rejecting requests.
     * 
     * @param userId - The user's ID from NearbyUser.id
     */
    async unpairUser(userId: string): Promise<void> {
        return this.ble.unpairUser(userId);
    }

    /**
     * Get list of recent pairings from storage (for history/recap features).
     * Returns pairs from the last N hours (default: 24h).
     * 
     * @param withinHours - Look back window in hours (default: 24)
     * @returns Array of NearbyUser objects representing recent pairs
     */
    async getRecentPairs(withinHours: number = 24): Promise<NearbyUser[]> {
        const recentScans = await this.storage.getRecentPairs(withinHours);

        // Map ScannedEvent to NearbyUser format for UI compatibility
        return recentScans.map(scan => ({
            id: scan.rpi, // Use RPI as ID for history items
            displayName: `User-${scan.rpi.substring(0, 5)}`, // Generate display name from RPI
            rssi: -50, // Fixed value for history (not actively scanned)
            discoveredAt: scan.timestamp,
            paired: true,
            hasIncomingRequest: false,
        }));
    }

    // ========================================================================
    // Reporting Methods
    // ========================================================================

    /**
     * Report positive (upload configured days of history).
     * 
     * @param attestToken - Optional attestation token (e.g., Firebase App Check)
     * @param metadata - App-specific data (e.g., STD type, test date). If null, a generic positive is reported.
     * @param overrideReportDays - Optional: Override reportDays for this specific report
     *                             (e.g., for apps with per-condition exposure windows)
     */
    async report(
        attestToken?: string,
        metadata?: ReportMetadata,
        overrideReportDays?: number
    ): Promise<boolean> {
        try {
            // Use override if provided, else fall back to global config
            const daysToReport = overrideReportDays ?? this.reportDays;
            const keys = this.identity.getHistory(daysToReport);

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

    // ========================================================================
    // Encryption Helpers
    // ========================================================================

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

    // ========================================================================
    // Event Handlers
    // ========================================================================

    /**
     * Subscribe to match events.
     * Returns cleanup function for React useEffect compatibility.
     */
    onMatch(handler: MatchHandler): () => void {
        this.matcher.on('match', handler);
        return () => this.matcher.off('match', handler);
    }

    /**
     * Subscribe to error events.
     * Returns cleanup function for React useEffect compatibility.
     */
    onError(handler: (error: Error) => void): () => void {
        this.matcher.on('error', handler);
        return () => this.matcher.off('error', handler);
    }

    /** Explicit cleanup for match handler */
    offMatch(handler: MatchHandler): void {
        this.matcher.off('match', handler);
    }

    /** Explicit cleanup for error handler */
    offError(handler: (error: Error) => void): void {
        this.matcher.off('error', handler);
    }

    // ========================================================================
    // Match Retrieval Methods (for on-demand decryption)
    // ========================================================================

    /**
     * Get a specific match by ID with decrypted metadata.
     * Used for on-demand decryption when user views exposure details.
     * 
     * @param matchId - RPI of the match to retrieve
     * @returns Match with decrypted metadata, or null if not found
     * 
     * @example
     * // App calls this when user taps on notification
     * const match = await sdk.getMatchById('abc123');
     * console.log(match.metadata.conditions); // ["HIV", "Syphilis"]
     */
    async getMatchById(matchId: string): Promise<Match | null> {
        return this.matcher.getMatchById(matchId);
    }

    /**
     * Get own display name (emoji + number derived from current RPI).
     * Used for showing user's anonymous identity in UI.
     */
    getOwnDisplayName(): string {
        return this.identity.getDisplayName();
    }
}

// Re-exports
export { formatQR, parseQR };
export type {
    Match,
    MatchHandler,
    ReportMetadata,
    KeyStorage,
    VailixConfig,
    NearbyUser,
    PairResult
};
