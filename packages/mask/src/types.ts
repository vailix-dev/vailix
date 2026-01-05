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
