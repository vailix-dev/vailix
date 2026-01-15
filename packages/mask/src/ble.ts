import { BleManager, Device, State, BleError } from 'react-native-ble-plx';
import type { NearbyUser, PairResult } from './types';
import type { StorageService } from './storage';

// ============================================================================
// Constants
// ============================================================================

// Service UUID (unique to Vailix)
const VAILIX_SERVICE_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

// Characteristic UUIDs (IN/OUT separation for security)
const RPI_OUT_CHAR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567891';  // Others read my RPI
const RPI_IN_CHAR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567892';   // Others write their RPI
const META_OUT_CHAR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567893'; // Others read my key
const META_IN_CHAR_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567894';  // Others write their key

// Defaults
const DEFAULT_DISCOVERY_TIMEOUT_MS = 15000;
const DEFAULT_PROXIMITY_THRESHOLD = -70;

import { generateDisplayName } from './utils';

// ============================================================================
// Internal Types (not exported - implementation details)
// ============================================================================

/**
 * Internal representation of a nearby user with additional fields for BLE management.
 * The public NearbyUser type hides these implementation details.
 */
interface InternalNearbyUser {
    id: string;
    displayName: string;
    rssi: number;
    discoveredAt: number;
    paired: boolean;
    hasIncomingRequest: boolean;
    pairedAt?: number;
    /** First 8 bytes (16 hex chars) of RPI from advertisement */
    rpiPrefix: string;
    /** Full RPI (received via GATT exchange) */
    fullRpi?: string;
    /** Metadata key (received via GATT exchange) */
    metadataKey?: string;
}

/**
 * Pending incoming pair request (explicit consent mode).
 * Holds data in memory until user accepts.
 */
interface PendingPairRequest {
    fullRpi: string;
    metadataKey: string;
    receivedAt: number;
}

/**
 * Configuration options for BleService constructor.
 */
interface BleServiceConfig {
    discoveryTimeoutMs?: number;
    proximityThreshold?: number;
    autoAccept?: boolean;
    serviceUUID?: string;
}

/**
 * Extract RPI prefix from advertisement manufacturer data or service data.
 */
function extractRpiPrefix(device: Device, serviceUUID: string): string | null {
    // Try to extract from service data first
    const serviceData = device.serviceData;
    if (serviceData && serviceData[serviceUUID]) {
        const data = serviceData[serviceUUID];
        if (data && data.length >= 16) {
            // First 16 chars = 8 bytes hex
            return data.substring(0, 16);
        }
    }

    // Fallback: try manufacturer data
    const mfgData = device.manufacturerData;
    if (mfgData && mfgData.length >= 16) {
        return mfgData.substring(0, 16);
    }

    return null;
}

// ============================================================================
// BleService Class
// ============================================================================

export class BleService {
    private manager: BleManager;
    private isScanning: boolean = false;
    private nearbyUsers: Map<string, InternalNearbyUser> = new Map();
    private pendingRequests: Map<string, PendingPairRequest> = new Map();

    // Configuration
    private discoveryTimeoutMs: number;
    private proximityThreshold: number;
    private autoAccept: boolean;
    private serviceUUID: string;


    // State
    private cleanupInterval?: ReturnType<typeof setInterval>;
    private scanSubscription?: { remove: () => void };
    private onNearbyUpdated?: (users: NearbyUser[]) => void;

    // Identity (set when discovery starts)
    private myRpi?: string;
    private myMetadataKey?: string;

    // Storage reference for persisting pairs
    private storage?: StorageService;

    constructor(config: BleServiceConfig = {}) {
        this.manager = new BleManager();
        this.discoveryTimeoutMs = config.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
        this.proximityThreshold = config.proximityThreshold ?? DEFAULT_PROXIMITY_THRESHOLD;
        this.autoAccept = config.autoAccept ?? true;
        this.serviceUUID = config.serviceUUID ?? VAILIX_SERVICE_UUID;
    }

    /**
     * Set storage service reference (called by SDK)
     */
    setStorage(storage: StorageService): void {
        this.storage = storage;
    }

    /**
     * Check if BLE is available and enabled
     */
    async initialize(): Promise<boolean> {
        return new Promise((resolve) => {
            const subscription = this.manager.onStateChange((state: typeof State[keyof typeof State]) => {
                if (state === State.PoweredOn) {
                    subscription.remove();
                    resolve(true);
                } else if (state === State.PoweredOff || state === State.Unauthorized) {
                    subscription.remove();
                    resolve(false);
                }
            }, true);
        });
    }

    /**
     * Check if BLE is supported on this device
     */
    static async isSupported(): Promise<boolean> {
        const manager = new BleManager();
        return new Promise((resolve) => {
            const subscription = manager.onStateChange((state: typeof State[keyof typeof State]) => {
                subscription.remove();
                manager.destroy();
                resolve(state !== State.Unsupported);
            }, true);
        });
    }

    /**
     * Start advertising our RPI + scanning for others.
     * Call when pairing screen opens.
     */
    async startDiscovery(myRpi: string, myMetadataKey: string): Promise<void> {
        if (this.isScanning) return;

        this.myRpi = myRpi;
        this.myMetadataKey = myMetadataKey;
        this.isScanning = true;
        this.nearbyUsers.clear();

        // Start cleanup interval to remove stale users
        this.startCleanupInterval();

        // Start scanning for other devices
        await this.startScanning();

        // Note: Advertising (peripheral role) requires native module support
        // react-native-ble-plx primarily supports central role
        // For full bidirectional exchange, we rely on GATT connections
    }

    /**
     * Stop advertising and scanning.
     * Call when leaving pairing screen.
     */
    async stopDiscovery(): Promise<void> {
        this.isScanning = false;

        if (this.scanSubscription) {
            this.scanSubscription.remove();
            this.scanSubscription = undefined;
        }

        this.manager.stopDeviceScan();

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }

        this.myRpi = undefined;
        this.myMetadataKey = undefined;
    }

    /**
     * Get current list of nearby users (public type without internal fields)
     */
    getNearbyUsers(): NearbyUser[] {
        return Array.from(this.nearbyUsers.values())
            .filter(u => u.rssi >= this.proximityThreshold)
            .map(this.toPublicUser);
    }

    /**
     * Subscribe to nearby user updates.
     * Returns cleanup function for React useEffect compatibility.
     */
    onNearbyUsersChanged(callback: (users: NearbyUser[]) => void): () => void {
        this.onNearbyUpdated = callback;
        return () => {
            this.onNearbyUpdated = undefined;
        };
    }

    /**
     * Initiate pairing with a specific user.
     * In explicit consent mode, this also accepts pending incoming requests.
     */
    async pairWithUser(userId: string): Promise<PairResult> {
        const internalUser = this.nearbyUsers.get(userId);
        if (!internalUser) {
            return { success: false, error: 'User not found' };
        }

        // Check if there's a pending incoming request (explicit consent mode)
        const pendingRequest = this.pendingRequests.get(userId);
        if (pendingRequest && !this.autoAccept) {
            // Accept the pending request
            return this.acceptPendingRequest(userId, pendingRequest);
        }

        // Initiate outgoing pairing
        try {
            const result = await this.doExchange(internalUser);
            return result;
        } catch (error) {
            // Check if we already have this user's RPI (paired via reverse connection)
            if (internalUser.fullRpi && this.storage) {
                const alreadyPaired = await this.hasStoredRpi(internalUser.fullRpi);
                if (alreadyPaired) {
                    return { success: true, partnerRpi: internalUser.fullRpi };
                }
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Unpair with a user (removes from storage and resets status)
     */
    async unpairUser(userId: string): Promise<void> {
        const internalUser = this.nearbyUsers.get(userId);
        if (internalUser) {
            internalUser.paired = false;
            internalUser.hasIncomingRequest = false;
            internalUser.fullRpi = undefined;
            internalUser.metadataKey = undefined;
            this.pendingRequests.delete(userId);
            this.emitUpdate();
        }
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        this.stopDiscovery();
        this.manager.destroy();
    }

    // ========================================================================
    // Private Methods
    // ========================================================================

    private async startScanning(): Promise<void> {
        this.manager.startDeviceScan(
            [this.serviceUUID],
            { allowDuplicates: true },
            (error: BleError | null, device: Device | null) => {
                if (error) {
                    console.warn('BLE scan error:', error);
                    return;
                }
                if (device) {
                    this.handleDiscoveredDevice(device);
                }
            }
        );
    }

    private handleDiscoveredDevice(device: Device): void {
        const rpiPrefix = extractRpiPrefix(device, this.serviceUUID);
        if (!rpiPrefix) return;

        const existingUser = this.nearbyUsers.get(device.id);

        if (existingUser) {
            // Update existing user
            existingUser.rssi = device.rssi ?? -100;
            existingUser.discoveredAt = Date.now();
        } else {
            // Add new user
            const newUser: InternalNearbyUser = {
                id: device.id,
                displayName: generateDisplayName(rpiPrefix),
                rssi: device.rssi ?? -100,
                discoveredAt: Date.now(),
                paired: false,
                hasIncomingRequest: false,
                rpiPrefix,
            };
            this.nearbyUsers.set(device.id, newUser);
        }

        this.emitUpdate();
    }

    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            let changed = false;

            for (const [id, user] of this.nearbyUsers) {
                if (now - user.discoveredAt > this.discoveryTimeoutMs) {
                    this.nearbyUsers.delete(id);
                    this.pendingRequests.delete(id);
                    changed = true;
                }
            }

            if (changed) {
                this.emitUpdate();
            }
        }, 1000);
    }

    private async doExchange(user: InternalNearbyUser): Promise<PairResult> {
        if (!this.myRpi || !this.myMetadataKey) {
            return { success: false, error: 'Discovery not started' };
        }

        let connectedDevice: Device | null = null;

        try {
            // Connect to the device
            connectedDevice = await this.manager.connectToDevice(user.id, {
                timeout: 10000,
            });

            // Discover services and characteristics
            await connectedDevice.discoverAllServicesAndCharacteristics();

            // Read partner's RPI
            const rpiChar = await connectedDevice.readCharacteristicForService(
                this.serviceUUID,
                RPI_OUT_CHAR_UUID
            );
            const partnerRpi = rpiChar.value ? Buffer.from(rpiChar.value, 'base64').toString('hex') : null;

            // Read partner's metadata key
            const metaChar = await connectedDevice.readCharacteristicForService(
                this.serviceUUID,
                META_OUT_CHAR_UUID
            );
            const partnerMetadataKey = metaChar.value ? Buffer.from(metaChar.value, 'base64').toString('hex') : null;

            if (!partnerRpi || !partnerMetadataKey) {
                return { success: false, error: 'Failed to read partner data' };
            }

            // Write our RPI to partner
            const myRpiBase64 = Buffer.from(this.myRpi, 'hex').toString('base64');
            await connectedDevice.writeCharacteristicWithResponseForService(
                this.serviceUUID,
                RPI_IN_CHAR_UUID,
                myRpiBase64
            );

            // Write our metadata key to partner
            const myMetaBase64 = Buffer.from(this.myMetadataKey, 'hex').toString('base64');
            await connectedDevice.writeCharacteristicWithResponseForService(
                this.serviceUUID,
                META_IN_CHAR_UUID,
                myMetaBase64
            );

            // Store partner's data locally
            if (this.storage) {
                const canStore = this.storage.canScan(partnerRpi);
                if (canStore) {
                    await this.storage.logScan(partnerRpi, partnerMetadataKey, Date.now());
                }
            }

            // Update internal state
            user.fullRpi = partnerRpi;
            user.metadataKey = partnerMetadataKey;
            user.paired = true;
            user.hasIncomingRequest = false;
            user.pairedAt = Date.now();
            this.emitUpdate();

            return {
                success: true,
                partnerRpi,
                partnerMetadataKey
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Connection failed';
            return { success: false, error: message };
        } finally {
            // Always disconnect
            if (connectedDevice) {
                try {
                    await this.manager.cancelDeviceConnection(connectedDevice.id);
                } catch {
                    // Ignore disconnect errors
                }
            }
        }
    }

    private async acceptPendingRequest(userId: string, request: PendingPairRequest): Promise<PairResult> {
        const user = this.nearbyUsers.get(userId);
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        // Store the data that was held in memory
        if (this.storage) {
            const canStore = this.storage.canScan(request.fullRpi);
            if (canStore) {
                await this.storage.logScan(request.fullRpi, request.metadataKey, Date.now());
            }
        }

        // Update state
        user.fullRpi = request.fullRpi;
        user.metadataKey = request.metadataKey;
        user.paired = true;
        user.hasIncomingRequest = false;
        user.pairedAt = Date.now();
        this.pendingRequests.delete(userId);
        this.emitUpdate();

        return {
            success: true,
            partnerRpi: request.fullRpi,
            partnerMetadataKey: request.metadataKey
        };
    }

    /**
     * Handle incoming write from another device (GATT server callback).
     * Called when another device writes to our RPI_IN or META_IN characteristics.
     */
    async handleIncomingPair(deviceId: string, rpi: string, metadataKey: string): Promise<void> {
        let user = this.nearbyUsers.get(deviceId);

        // Create user entry if not exists
        if (!user) {
            user = {
                id: deviceId,
                displayName: generateDisplayName(rpi.substring(0, 16)),
                rssi: -50, // Assume close proximity for incoming connection
                discoveredAt: Date.now(),
                paired: false,
                hasIncomingRequest: false,
                rpiPrefix: rpi.substring(0, 16),
            };
            this.nearbyUsers.set(deviceId, user);
        }

        if (this.autoAccept) {
            // Auto-accept: store immediately
            if (this.storage) {
                const canStore = this.storage.canScan(rpi);
                if (canStore) {
                    await this.storage.logScan(rpi, metadataKey, Date.now());
                }
            }
            user.fullRpi = rpi;
            user.metadataKey = metadataKey;
            user.paired = true;
            user.hasIncomingRequest = false;
            user.pairedAt = Date.now();
        } else {
            // Explicit consent mode: hold in memory
            this.pendingRequests.set(deviceId, {
                fullRpi: rpi,
                metadataKey,
                receivedAt: Date.now(),
            });
            user.hasIncomingRequest = true;
            user.paired = false;
        }

        this.emitUpdate();
    }

    private async hasStoredRpi(rpi: string): Promise<boolean> {
        if (!this.storage) return false;
        // Check if we can scan (if not, it means we already have it)
        return !this.storage.canScan(rpi);
    }

    private toPublicUser(internal: InternalNearbyUser): NearbyUser {
        return {
            id: internal.id,
            displayName: internal.displayName,
            rssi: internal.rssi,
            discoveredAt: internal.discoveredAt,
            paired: internal.paired,
            hasIncomingRequest: internal.hasIncomingRequest,
        };
    }

    private emitUpdate(): void {
        if (this.onNearbyUpdated) {
            const publicUsers = Array.from(this.nearbyUsers.values())
                .filter(u => u.rssi >= this.proximityThreshold)
                .map(u => this.toPublicUser(u));
            this.onNearbyUpdated(publicUsers);
        }
    }
}

