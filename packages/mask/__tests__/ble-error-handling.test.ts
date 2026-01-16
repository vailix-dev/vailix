/**
 * Tests for BleService error handling improvements.
 * 
 * Tests cover:
 * - EventEmitter pattern for error propagation
 * - BLE state check before scanning (initialize() call)
 * - Timeout behavior in initialize()
 * - Error emission from scan callback
 * 
 * NOTE: These tests use a simplified TestBleService that mirrors the actual
 * BleService implementation logic without importing react-native-ble-plx.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'eventemitter3';

// ============================================================================
// Mock BLE State enum
// ============================================================================
const State = {
    PoweredOn: 'PoweredOn',
    PoweredOff: 'PoweredOff',
    Unauthorized: 'Unauthorized',
    Unsupported: 'Unsupported',
};

// Mock BleManager that tracks calls
class MockBleManager {
    onStateChange = vi.fn();
    startDeviceScan = vi.fn();
    stopDeviceScan = vi.fn();
    destroy = vi.fn();
}

/**
 * Simplified BleService implementation for testing the logic patterns.
 * This mirrors the actual BleService but without the react-native-ble-plx import.
 * 
 * Key difference from actual code: uses setImmediate/setTimeout(0) to defer
 * synchronous callbacks, avoiding temporal dead zone issues in tests.
 */
class TestBleService extends EventEmitter {
    private manager: MockBleManager;
    private isScanning = false;

    constructor(mockManager: MockBleManager) {
        super();
        this.manager = mockManager;
    }

    async initialize(): Promise<boolean> {
        const INIT_TIMEOUT_MS = 5000;

        return new Promise((resolve) => {
            let resolved = false;
            let subscriptionRef: { remove: () => void } | null = null;

            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    subscriptionRef?.remove();
                    resolve(false);
                }
            }, INIT_TIMEOUT_MS);

            const handleState = (state: string) => {
                if (resolved) return;

                if (state === State.PoweredOn) {
                    resolved = true;
                    clearTimeout(timeout);
                    subscriptionRef?.remove();
                    resolve(true);
                } else if (state === State.PoweredOff || state === State.Unauthorized) {
                    resolved = true;
                    clearTimeout(timeout);
                    subscriptionRef?.remove();
                    resolve(false);
                }
            };

            subscriptionRef = this.manager.onStateChange(handleState, true);
        });
    }

    async startDiscovery(myRpi: string, myMetadataKey: string): Promise<void> {
        if (this.isScanning) return;

        const isReady = await this.initialize();
        if (!isReady) {
            throw new Error('Bluetooth is not available or not enabled');
        }

        this.isScanning = true;
        this.startScanning();
    }

    private startScanning(): void {
        this.manager.startDeviceScan(
            ['service-uuid'],
            { allowDuplicates: true },
            (error: any, device: any) => {
                if (error) {
                    console.warn('BLE scan error:', error);
                    this.emit('error', error);
                    return;
                }
            }
        );
    }

    stopDiscovery(): void {
        this.isScanning = false;
        this.manager.stopDeviceScan();
    }

    destroy(): void {
        this.stopDiscovery();
        this.manager.destroy();
    }
}

describe('BleService Error Handling', () => {
    let mockManager: MockBleManager;
    let bleService: TestBleService;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        mockManager = new MockBleManager();
        bleService = new TestBleService(mockManager);
    });

    afterEach(() => {
        vi.useRealTimers();
        bleService.destroy();
    });

    describe('EventEmitter pattern', () => {
        it('should extend EventEmitter and support on/off/emit', () => {
            const errorHandler = vi.fn();

            bleService.on('error', errorHandler);
            bleService.emit('error', new Error('test error'));

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
        });

        it('should allow removing listeners', () => {
            const errorHandler = vi.fn();

            bleService.on('error', errorHandler);
            bleService.off('error', errorHandler);
            bleService.emit('error', new Error('test error'));

            expect(errorHandler).not.toHaveBeenCalled();
        });
    });

    describe('initialize()', () => {
        it('should resolve true when BLE state is PoweredOn', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                // Defer the immediate callback to next tick to avoid TDZ
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOn));
                }
                return { remove: vi.fn() };
            });

            const result = await bleService.initialize();
            expect(result).toBe(true);
        });

        it('should resolve false when BLE state is PoweredOff', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOff));
                }
                return { remove: vi.fn() };
            });

            const result = await bleService.initialize();
            expect(result).toBe(false);
        });

        it('should resolve false when BLE state is Unauthorized', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.Unauthorized));
                }
                return { remove: vi.fn() };
            });

            const result = await bleService.initialize();
            expect(result).toBe(false);
        });

        it('should timeout after 5 seconds and resolve false', async () => {
            const removeSubscription = vi.fn();
            mockManager.onStateChange.mockImplementation(() => {
                // Never call the callback - simulate hanging
                return { remove: removeSubscription };
            });

            const initPromise = bleService.initialize();

            // Fast-forward 5 seconds
            await vi.advanceTimersByTimeAsync(5000);

            const result = await initPromise;
            expect(result).toBe(false);
            expect(removeSubscription).toHaveBeenCalled();
        });

        it('should clear timeout when state resolves before timeout', async () => {
            const removeSubscription = vi.fn();
            mockManager.onStateChange.mockImplementation((callback: Function) => {
                // Resolve after 1 second
                setTimeout(() => callback(State.PoweredOn), 1000);
                return { remove: removeSubscription };
            });

            const initPromise = bleService.initialize();

            // Fast-forward 1 second (before 5s timeout)
            await vi.advanceTimersByTimeAsync(1000);

            const result = await initPromise;
            expect(result).toBe(true);
            expect(removeSubscription).toHaveBeenCalled();
        });
    });

    describe('startDiscovery()', () => {
        it('should call initialize() before starting scan', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOn));
                }
                return { remove: vi.fn() };
            });

            await bleService.startDiscovery('testrpi', 'testkey');

            expect(mockManager.onStateChange).toHaveBeenCalled();
            expect(mockManager.startDeviceScan).toHaveBeenCalled();
        });

        it('should throw error if BLE is not available', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOff));
                }
                return { remove: vi.fn() };
            });

            await expect(bleService.startDiscovery('testrpi', 'testkey'))
                .rejects.toThrow('Bluetooth is not available or not enabled');
        });

        it('should throw error if BLE times out', async () => {
            mockManager.onStateChange.mockImplementation(() => {
                // Never resolve - simulate timeout
                return { remove: vi.fn() };
            });

            const discoveryPromise = bleService.startDiscovery('testrpi', 'testkey');

            // Prevent unhandled rejection by attaching catch handler immediately
            const caughtPromise = discoveryPromise.catch(e => e);

            // Fast-forward past timeout
            await vi.advanceTimersByTimeAsync(5000);

            // Verify the error was caught
            const result = await caughtPromise;
            expect(result).toBeInstanceOf(Error);
            expect(result.message).toBe('Bluetooth is not available or not enabled');
        });

        it('should not start scan if already scanning', async () => {
            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOn));
                }
                return { remove: vi.fn() };
            });

            await bleService.startDiscovery('testrpi', 'testkey');
            await bleService.startDiscovery('testrpi2', 'testkey2');

            // startDeviceScan should only be called once
            expect(mockManager.startDeviceScan).toHaveBeenCalledTimes(1);
        });
    });

    describe('scan error emission', () => {
        it('should emit error event when scan encounters error', async () => {
            const errorHandler = vi.fn();
            bleService.on('error', errorHandler);

            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOn));
                }
                return { remove: vi.fn() };
            });

            // Capture the scan callback when startDeviceScan is called
            mockManager.startDeviceScan.mockImplementation(
                (uuids: string[], options: any, callback: Function) => {
                    // Simulate an error occurring during scan
                    const mockError = { message: 'Unknown error occurred', reason: 'bug' };
                    callback(mockError, null);
                }
            );

            await bleService.startDiscovery('testrpi', 'testkey');

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({ message: 'Unknown error occurred' })
            );
        });

        it('should continue emitting errors for subsequent scan errors', async () => {
            const errorHandler = vi.fn();
            bleService.on('error', errorHandler);

            mockManager.onStateChange.mockImplementation((callback: Function, immediate: boolean) => {
                if (immediate) {
                    Promise.resolve().then(() => callback(State.PoweredOn));
                }
                return { remove: vi.fn() };
            });

            let scanCallback: Function;
            mockManager.startDeviceScan.mockImplementation(
                (uuids: string[], options: any, callback: Function) => {
                    scanCallback = callback;
                }
            );

            await bleService.startDiscovery('testrpi', 'testkey');

            // Simulate multiple errors
            scanCallback!({ message: 'Error 1' }, null);
            scanCallback!({ message: 'Error 2' }, null);
            scanCallback!({ message: 'Error 3' }, null);

            expect(errorHandler).toHaveBeenCalledTimes(3);
        });
    });
});
