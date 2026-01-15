import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, deleteDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { sql } from 'drizzle-orm';
import type { VailixDB } from './types';

const DB_NAME = 'vailix.db';

/**
 * Initialize encrypted database using SQLCipher.
 * If database exists but key doesn't match (e.g., restored backup with new key),
 * the corrupted database is deleted and recreated fresh.
 * 
 * @param masterKey The user's master key, used to derive encryption password
 */
export async function initializeDatabase(masterKey: string): Promise<VailixDB> {
    const result = await tryOpenEncryptedDatabase(masterKey);
    
    if (result.success) {
        return result.db;
    }
    
    // Key mismatch: "file is not a database" or similar SQLCipher error
    // This happens when DB was restored from backup but key is different
    console.warn('Database key mismatch, recreating fresh database');
    
    // Close the connection before deletion (required by SQLite)
    if (result.expo) {
        result.expo.closeSync();
    }
    
    deleteDatabaseSync(DB_NAME);
    
    // Retry - if this fails, let it throw (unrecoverable error)
    const retryResult = await tryOpenEncryptedDatabase(masterKey);
    if (!retryResult.success) {
        if (retryResult.expo) {
            retryResult.expo.closeSync();
        }
        throw retryResult.error;
    }
    
    return retryResult.db;
}

type OpenResult = 
    | { success: true; db: VailixDB; expo: SQLiteDatabase }
    | { success: false; error: Error; expo: SQLiteDatabase | null };

/**
 * Attempt to open and configure the encrypted database.
 * Returns a result object that includes the raw expo connection for cleanup.
 */
async function tryOpenEncryptedDatabase(masterKey: string): Promise<OpenResult> {
    let expo: SQLiteDatabase | null = null;
    
    try {
        expo = openDatabaseSync(DB_NAME);
        const db = drizzle(expo);

        // Validate key is hex to prevent SQL injection
        if (!/^[0-9a-f]+$/i.test(masterKey)) {
            throw new Error('Invalid master key format');
        }
        
        // Enable SQLCipher encryption using master key as password
        // This encrypts the entire database at rest (AES-256)
        await db.run(sql.raw(`PRAGMA key = '${masterKey}'`));

        // Verify key works by attempting a read operation
        // SQLCipher will throw if key is wrong
        await db.run(sql`SELECT 1`);

        // Create schema
        await db.run(sql`
            CREATE TABLE IF NOT EXISTS scanned_events (
                id TEXT PRIMARY KEY,
                rpi TEXT NOT NULL,
                metadata_key TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            )
        `);

        await db.run(sql`
            CREATE INDEX IF NOT EXISTS rpi_idx ON scanned_events(rpi)
        `);

        return { success: true, db, expo };
    } catch (error) {
        return { 
            success: false, 
            error: error instanceof Error ? error : new Error(String(error)),
            expo 
        };
    }
}
