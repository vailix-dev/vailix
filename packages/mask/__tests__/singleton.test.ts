/**
 * Tests for VailixSDK singleton pattern.
 * 
 * These tests verify that the race condition fix works correctly:
 * - Multiple concurrent calls return the same instance
 * - The promise is set atomically (no gap between check and set)
 * - destroy() properly resets the singleton
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to test the singleton pattern in isolation.
// Since VailixSDK.doCreate has many dependencies, we'll mock them.

// Mock all the heavy dependencies using proper class constructors
vi.mock('../src/identity', () => {
    return {
        IdentityManager: class MockIdentityManager {
            initialize = vi.fn().mockResolvedValue(undefined);
            getMasterKey = vi.fn().mockReturnValue('0123456789abcdef0123456789abcdef');
            getCurrentRPI = vi.fn().mockReturnValue('testrpi');
            getMetadataKey = vi.fn().mockReturnValue('testkey');
            getHistory = vi.fn().mockReturnValue([]);
            getDisplayName = vi.fn().mockReturnValue('Test-123');
        },
    };
});

vi.mock('../src/db', () => ({
    initializeDatabase: vi.fn().mockResolvedValue({
        run: vi.fn().mockResolvedValue(undefined),
    }),
}));

vi.mock('../src/storage', () => {
    return {
        StorageService: class MockStorageService {
            initialize = vi.fn().mockResolvedValue(undefined);
            cleanupOldScans = vi.fn().mockResolvedValue(undefined);
            canScan = vi.fn().mockReturnValue(true);
            logScan = vi.fn().mockResolvedValue(undefined);
            getRecentPairs = vi.fn().mockResolvedValue([]);
        },
    };
});

vi.mock('../src/matcher', () => {
    return {
        MatcherService: class MockMatcherService {
            on = vi.fn();
            off = vi.fn();
            emit = vi.fn();
            getMatchById = vi.fn().mockResolvedValue(null);
        },
    };
});

vi.mock('../src/ble', () => {
    return {
        BleService: class MockBleService {
            setStorage = vi.fn();
            destroy = vi.fn();
            startDiscovery = vi.fn().mockResolvedValue(undefined);
            stopDiscovery = vi.fn().mockResolvedValue(undefined);
            getNearbyUsers = vi.fn().mockReturnValue([]);
            onNearbyUsersChanged = vi.fn().mockReturnValue(() => { });
            pairWithUser = vi.fn().mockResolvedValue({ success: true });
            unpairUser = vi.fn().mockResolvedValue(undefined);
        },
    };
});

vi.mock('react-native-quick-crypto', () => ({
    createCipheriv: vi.fn(),
    randomBytes: vi.fn().mockReturnValue(Buffer.alloc(12)),
}));

// Import after mocks are set up
import { VailixSDK } from '../src/index';

const TEST_CONFIG = {
    appSecret: 'test-secret',
    reportUrl: 'https://test.example.com',
    downloadUrl: 'https://test.example.com',
};

describe('VailixSDK Singleton Pattern', () => {
    beforeEach(async () => {
        // Reset singleton state before each test
        await VailixSDK.destroy();
        vi.clearAllMocks();
    });

    describe('create()', () => {
        it('should return the same instance on multiple sequential calls', async () => {
            const sdk1 = await VailixSDK.create(TEST_CONFIG);
            const sdk2 = await VailixSDK.create(TEST_CONFIG);
            const sdk3 = await VailixSDK.create(TEST_CONFIG);

            expect(sdk1).toBe(sdk2);
            expect(sdk2).toBe(sdk3);
        });

        it('should return the same instance on concurrent calls (race condition test)', async () => {
            // Launch multiple concurrent create() calls
            const promises = [
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
            ];

            const results = await Promise.all(promises);

            // All should be the exact same instance
            const firstInstance = results[0];
            results.forEach((sdk) => {
                expect(sdk).toBe(firstInstance);
            });
        });

        it('should only initialize once even with concurrent calls', async () => {
            const { initializeDatabase } = await import('../src/db');

            // Launch concurrent calls
            await Promise.all([
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
                VailixSDK.create(TEST_CONFIG),
            ]);

            // initializeDatabase should only be called once
            expect(initializeDatabase).toHaveBeenCalledTimes(1);
        });

        it('should use config from first call only', async () => {
            const config1 = { ...TEST_CONFIG, reportUrl: 'https://first.com' };
            const config2 = { ...TEST_CONFIG, reportUrl: 'https://second.com' };

            const sdk1 = await VailixSDK.create(config1);
            const sdk2 = await VailixSDK.create(config2);

            // Both should be the same instance
            expect(sdk1).toBe(sdk2);
            // The instance should use the first config (verified indirectly by same instance)
        });
    });

    describe('isInitialized()', () => {
        it('should return false before create() is called', () => {
            expect(VailixSDK.isInitialized()).toBe(false);
        });

        it('should return true after create() completes', async () => {
            await VailixSDK.create(TEST_CONFIG);
            expect(VailixSDK.isInitialized()).toBe(true);
        });

        it('should return false after destroy() is called', async () => {
            await VailixSDK.create(TEST_CONFIG);
            expect(VailixSDK.isInitialized()).toBe(true);

            await VailixSDK.destroy();
            expect(VailixSDK.isInitialized()).toBe(false);
        });
    });

    describe('destroy()', () => {
        it('should allow creating a new instance after destroy', async () => {
            const sdk1 = await VailixSDK.create(TEST_CONFIG);
            await VailixSDK.destroy();

            const sdk2 = await VailixSDK.create(TEST_CONFIG);

            // Should be different instances
            expect(sdk1).not.toBe(sdk2);
        });

        it('should be safe to call destroy() multiple times', async () => {
            await VailixSDK.create(TEST_CONFIG);

            // Multiple destroy calls should not throw
            await VailixSDK.destroy();
            await VailixSDK.destroy();
            await VailixSDK.destroy();

            expect(VailixSDK.isInitialized()).toBe(false);
        });

        it('should be safe to call destroy() without prior create()', async () => {
            // Should not throw
            await VailixSDK.destroy();
            expect(VailixSDK.isInitialized()).toBe(false);
        });
    });

    describe('Race condition stress test', () => {
        it('should handle many concurrent calls correctly', async () => {
            const CONCURRENT_CALLS = 100;

            const promises = Array.from({ length: CONCURRENT_CALLS }, () =>
                VailixSDK.create(TEST_CONFIG)
            );

            const results = await Promise.all(promises);

            // All should be the exact same instance
            const firstInstance = results[0];
            expect(results.every(sdk => sdk === firstInstance)).toBe(true);

            // Verify initialization only happened once
            const { initializeDatabase } = await import('../src/db');
            expect(initializeDatabase).toHaveBeenCalledTimes(1);
        });

        it('should handle interleaved create and destroy calls', async () => {
            // First creation
            const sdk1 = await VailixSDK.create(TEST_CONFIG);

            // Destroy and recreate
            await VailixSDK.destroy();
            const sdk2 = await VailixSDK.create(TEST_CONFIG);

            // Destroy and recreate again
            await VailixSDK.destroy();
            const sdk3 = await VailixSDK.create(TEST_CONFIG);

            // All should be different instances
            expect(sdk1).not.toBe(sdk2);
            expect(sdk2).not.toBe(sdk3);
            expect(sdk1).not.toBe(sdk3);
        });
    });
});
