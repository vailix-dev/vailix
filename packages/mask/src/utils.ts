/**
 * Shared utilities for @vailix/mask
 */

// Display name generation constants
export const EMOJIS = ['🐼', '🦊', '🐨', '🦁', '🐯', '🐸', '🦋', '🐙', '🦄', '🐳'];

/**
 * Generate deterministic display name from truncated RPI (or full RPI).
 * Ensures all scanners see the same name for the same user.
 * 
 * @param rpiPrefix - RPI or RPI prefix (at least 8 chars recommended)
 * @returns Emoji + Number string (e.g., "🐼 42")
 */
export function generateDisplayName(rpiPrefix: string): string {
    const hash = rpiPrefix.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const emoji = EMOJIS[hash % EMOJIS.length];
    const number = hash % 100;
    return `${emoji} ${number}`;
}
