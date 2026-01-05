const VERSION = 'v1';

// Format: proto:v1:rpi:timestamp:metadataKey
export function formatQR(rpi: string, metadataKey: string): string {
    return `proto:${VERSION}:${rpi}:${Date.now()}:${metadataKey}`;
}

export function parseQR(data: string): ParsedQR | null {
    const p = data.split(':');
    if (p.length !== 5 || p[0] !== 'proto' || p[1] !== VERSION) return null;
    const ts = parseInt(p[3], 10);
    if (isNaN(ts)) return null;
    return { rpi: p[2], timestamp: ts, metadataKey: p[4] };
}

interface ParsedQR {
    rpi: string;
    timestamp: number;
    metadataKey: string;
}
