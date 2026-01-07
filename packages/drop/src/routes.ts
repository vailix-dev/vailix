import { Type } from '@sinclair/typebox';
import { KeyModel } from './db';
import type { FastifyInstance } from 'fastify';

const ReportSchema = Type.Object({
    reports: Type.Array(Type.Object({
        rpi: Type.String({ minLength: 32, maxLength: 32, pattern: '^[a-f0-9]{32}$' }),
        encryptedMetadata: Type.String({ maxLength: 10240 }) // 10KB max, defense-in-depth
    }), { maxItems: 1500 })
});

export function registerRoutes(server: FastifyInstance) {
    server.post('/v1/report', { schema: { body: ReportSchema } }, async (req) => {
        const { reports } = req.body as { reports: Array<{ rpi: string, encryptedMetadata: string }> };

        // Convert hex RPIs to Buffers for efficient storage
        const ops = reports.map((item) => {
            const rpiBuffer = Buffer.from(item.rpi, 'hex');
            return {
                updateOne: {
                    filter: { rpi: rpiBuffer },
                    update: { $setOnInsert: { rpi: rpiBuffer, metadata: item.encryptedMetadata || null } },
                    upsert: true,
                },
            };
        });

        await KeyModel.bulkWrite(ops, { ordered: false });
        return { success: true };
    });

    server.get('/v1/download', async (req, reply) => {
        const { since = '0', cursor, format = 'bin' } = req.query as { since?: string; cursor?: string; format?: string };
        const query: any = { createdAt: { $gte: new Date(parseInt(since, 10)) } };
        if (cursor) query._id = { $gt: cursor };

        const keys = await KeyModel.find(query)
            .sort({ _id: 1 })
            .limit(20000) // Increase batch size for binary
            .select('rpi metadata createdAt _id')
            .lean();

        const hasMore = keys.length >= 20000;
        const nextCursor = hasMore ? keys[keys.length - 1]._id.toString() : '';

        if (format === 'bin') {
            const buffer = serializeKeys(keys);
            reply.header('x-vailix-next-cursor', nextCursor);
            reply.header('Content-Type', 'application/octet-stream');
            return buffer;
        }

        // JSON fallback (debug)
        return {
            keys: keys.map((k) => ({
                rpi: Buffer.from((k.rpi as any).buffer || k.rpi).toString('hex'), // Convert binary back to hex for JSON
                metadata: k.metadata,
                reportedAt: k.createdAt.getTime(),
            })),
            nextCursor: hasMore ? nextCursor : null,
        };
    });
}

function serializeKeys(keys: any[]): Buffer {
    let size = 4; // Count (4 bytes)

    // First pass: calculate size
    for (const k of keys) {
        size += 16; // RPI (16 bytes binary)
        size += 8;  // Timestamp (8 bytes)
        size += 2;  // Metadata Length (2 bytes)
        if (k.metadata) {
            // k.metadata is string here (from DB)
            size += Buffer.byteLength(k.metadata);
        }
    }

    const buffer = Buffer.allocUnsafe(size);
    let offset = 0;

    // Header: Count
    buffer.writeUInt32BE(keys.length, offset);
    offset += 4;

    for (const k of keys) {
        // RPI: Mongoose .lean() returns BSON Binary objects, not Node Buffers
        // Binary objects have a .buffer property containing the raw data
        const rpiBuf = Buffer.from((k.rpi as any).buffer || k.rpi);
        rpiBuf.copy(buffer, offset, 0, 16);
        offset += 16;

        // Timestamp
        const ts = k.createdAt.getTime();
        buffer.writeDoubleBE(ts, offset);
        offset += 8;

        // Metadata
        const metaStr = k.metadata || '';
        const metaLen = Buffer.byteLength(metaStr);

        buffer.writeUInt16BE(metaLen, offset);
        offset += 2;

        if (metaLen > 0) {
            buffer.write(metaStr, offset);
            offset += metaLen;
        }
    }

    return buffer;
}
