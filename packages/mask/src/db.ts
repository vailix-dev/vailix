import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync, deleteDatabaseSync } from 'expo-sqlite';
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
    try {
        return await openEncryptedDatabase(masterKey);
    } catch (error) {
        // Key mismatch: "file is not a database" or similar SQLCipher error
        // This happens when DB was restored from backup but key is different
        console.warn('Database key mismatch, recreating fresh database');
        deleteDatabaseSync(DB_NAME);
        return await openEncryptedDatabase(masterKey);
    }
}

async function openEncryptedDatabase(masterKey: string): Promise<VailixDB> {
    const expo = openDatabaseSync(DB_NAME);
    const db = drizzle(expo);

    // Enable SQLCipher encryption using master key as password
    // This encrypts the entire database at rest (AES-256)
    // Validate key is hex to prevent SQL injection
    if (!/^[0-9a-f]+$/i.test(masterKey)) {
        throw new Error('Invalid master key format');
    }
    await db.run(sql.raw(`PRAGMA key = '${masterKey}'`));

    // Verify key works by attempting a read operation
    // SQLCipher will throw if key is wrong
    await db.run(sql`SELECT 1`);

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

    return db;
}
