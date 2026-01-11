import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { lt, gt, inArray } from 'drizzle-orm';
import { randomUUID } from 'react-native-quick-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { VailixDB } from './types';

const SCAN_HISTORY_KEY = 'vailix_scan_history';

export const scannedEvents = sqliteTable('scanned_events', {
    id: text('id').primaryKey(),
    rpi: text('rpi').notNull(),
    metadataKey: text('metadata_key').notNull(),
    timestamp: integer('timestamp').notNull(),
}, (t) => [index('rpi_idx').on(t.rpi)]);

/** Type for a scanned event row */
export type ScannedEvent = typeof scannedEvents.$inferSelect;

export class StorageService {
    private rescanIntervalMs: number;
    private lastScanByRpi = new Map<string, number>();

    // Limit scan history to prevent unbounded memory growth
    private static readonly MAX_SCAN_HISTORY_SIZE = 10000;

    constructor(private db: VailixDB, config: { rescanIntervalMs?: number } = {}) {
        this.rescanIntervalMs = config.rescanIntervalMs ?? 0;
    }

    // Load persisted scan history on init
    async initialize(): Promise<void> {
        const stored = await AsyncStorage.getItem(SCAN_HISTORY_KEY);
        if (stored) {
            const entries: [string, number][] = JSON.parse(stored);
            this.lastScanByRpi = new Map(entries);
        }
    }

    // Check if rescan is allowed for this RPI
    canScan(rpi: string): boolean {
        if (this.rescanIntervalMs === 0) return true;
        const lastScan = this.lastScanByRpi.get(rpi);
        if (!lastScan) return true;
        return Date.now() - lastScan >= this.rescanIntervalMs;
    }

    async logScan(rpi: string, metadataKey: string, timestamp: number): Promise<void> {
        await this.db.insert(scannedEvents).values({ id: randomUUID(), rpi, metadataKey, timestamp });
        this.lastScanByRpi.set(rpi, Date.now());

        // Prune oldest entries if exceeding max size (prevents unbounded growth)
        if (this.lastScanByRpi.size > StorageService.MAX_SCAN_HISTORY_SIZE) {
            const entries = Array.from(this.lastScanByRpi.entries());
            entries.sort((a, b) => a[1] - b[1]); // Sort by timestamp ascending
            const toRemove = entries.slice(0, entries.length - StorageService.MAX_SCAN_HISTORY_SIZE);
            for (const [key] of toRemove) {
                this.lastScanByRpi.delete(key);
            }
        }

        // Persist scan history
        const entries = Array.from(this.lastScanByRpi.entries());
        await AsyncStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(entries));
    }

    async cleanupOldScans(): Promise<void> {
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        await this.db.delete(scannedEvents).where(lt(scannedEvents.timestamp, cutoff));
        // Also cleanup old RPI entries
        if (this.rescanIntervalMs > 0) {
            const now = Date.now();
            for (const [rpi, lastScan] of this.lastScanByRpi) {
                if (now - lastScan > this.rescanIntervalMs) {
                    this.lastScanByRpi.delete(rpi);
                }
            }
            const entries = Array.from(this.lastScanByRpi.entries());
            await AsyncStorage.setItem(SCAN_HISTORY_KEY, JSON.stringify(entries));
        }
    }

    // Get only scans matching the given RPIs (efficient DB-level filtering)
    // Batches queries to respect SQLite variable limits
    async getMatchingScans(rpiList: string[]): Promise<ScannedEvent[]> {
        if (rpiList.length === 0) return [];

        // SQLite limit is often 999 or 32766 variables. 
        // We stick to a safe 500 batch size to be conservative across devices.
        const BATCH_SIZE = 500;
        const results: ScannedEvent[] = [];

        for (let i = 0; i < rpiList.length; i += BATCH_SIZE) {
            const batch = rpiList.slice(i, i + BATCH_SIZE);
            const batchResults = await this.db.select().from(scannedEvents)
                .where(inArray(scannedEvents.rpi, batch));
            results.push(...batchResults);
        }

        return results;
    }

    async getRecentPairs(withinHours: number = 24): Promise<ScannedEvent[]> {
        const cutoff = Date.now() - (withinHours * 60 * 60 * 1000);
        const recent = await this.db.select()
            .from(scannedEvents)
            .where(gt(scannedEvents.timestamp, cutoff))
            .orderBy(scannedEvents.timestamp);
        return recent;
    }
}
