import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';

// Optional metadata apps can attach when reporting
export interface ReportMetadata {
    [key: string]: string | number | boolean | undefined;
}

// Match result with optional reporter metadata
export interface Match {
    rpi: string;
    timestamp: number;
    metadata?: ReportMetadata;
    reportedAt?: number;
}

export interface ScanEvent {
    id: string;
    rpi: string;
    timestamp: number;
}

// Key storage interface — allows apps to provide custom storage (e.g., iCloud sync)
export interface KeyStorage {
    getKey(): Promise<string | null>;
    setKey(key: string): Promise<void>;
}

export type MatchHandler = (matches: Match[]) => void;
export type VailixDB = ExpoSQLiteDatabase<Record<string, never>>;

// ============================================================================
// BLE Types
// ============================================================================

/**
 * Represents a nearby user discovered via BLE.
 * 
 * Design: Internal details (RPI, metadataKey) are hidden from the public API.
 * The app only needs: something to display, something to pair with, and status flags.
 * RPIs and keys are managed internally by the package for contact tracing.
 */
export interface NearbyUser {
    /** Opaque identifier for pairing (pass to pairWithUser) */
    id: string;
    /** Generated emoji + number for UI display */
    displayName: string;
    /** Signal strength (for proximity filtering) */
    rssi: number;
    /** Timestamp of last advertisement received */
    discoveredAt: number;
    /** true if we have securely stored their data */
    paired: boolean;
    /** true if they sent us data but we haven't accepted yet (explicit mode) */
    hasIncomingRequest: boolean;
}

/** Result of a pairing attempt */
export interface PairResult {
    success: boolean;
    partnerRpi?: string;
    partnerMetadataKey?: string;
    error?: string;
}

/**
 * Unified SDK Configuration Interface
 */
export interface VailixConfig {
    // --- Backend & Auth ---
    /** The live API endpoint for submitting reports */
    reportUrl: string;
    /** The endpoint for downloading keys (can be the same as reportUrl or a CDN) */
    downloadUrl: string;
    /** Application secret for API authentication */
    appSecret: string;

    // --- Storage ---
    /** Custom key storage adapter (default: expo-secure-store) */
    keyStorage?: KeyStorage;
    /** Number of days of history to include in reports (default: 14) */
    reportDays?: number;

    // --- Contact Tracing Protocol ---
    /** How long RPI persists in ms (default: 15min, can be 24h for STD apps) */
    rpiDurationMs?: number;
    /** Minimum time between scans of same RPI in ms (default: 0 = no limit) */
    rescanIntervalMs?: number;

    // --- BLE Proximity & Pairing ---
    /** Timeout before removing a user from nearby list in ms (default: 15000) */
    bleDiscoveryTimeoutMs?: number;
    /** Minimum RSSI to consider a user "nearby" (default: -70) */
    proximityThreshold?: number;
    /** If true, automatically pair when receiving a write (default: true) */
    autoAcceptIncomingPairs?: boolean;
}