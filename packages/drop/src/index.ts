import 'dotenv/config';
import { timingSafeEqual } from 'crypto';
import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { registerRoutes } from './routes';
import { attestVerifier } from './attest';

export interface VailixOptions {
    mongoUri: string;
    secret: string;
    retentionDays?: number;  // TTL in days (default: 14)
    attestVerifier?: (token: string | undefined) => Promise<boolean>;
}

// 1. THE PLUGIN (Embeddable)
const vailixPlugin: FastifyPluginAsync<VailixOptions> = async (fastify, options) => {
    if (!options.mongoUri) throw new Error('mongoUri is required');
    if (!options.secret) throw new Error('secret is required');

    // Connect DB if not already connected
    if (mongoose.connection.readyState === 0) {
        await mongoose.connect(options.mongoUri);
        console.log('Vailix connected to MongoDB');
    }

    // Register Middleware
    await fastify.register(helmet);
    await fastify.register(compress);
    await fastify.register(cors);
    // Rate limit: 300/min to allow chunked sync (approx 7 requests for 14-day history at 20k/page)
    await fastify.register(rateLimit, { max: 300, timeWindow: '1 minute' });

    // Auth Hook
    fastify.addHook('preHandler', async (req, reply) => {
        // Use routeOptions.url for exact route matching (ignores query strings)
        const routePath = req.routeOptions.url;

        // Skip auth for /health endpoints registered within the plugin scope.
        // Note: In standalone mode, /health is outside plugin scope so this doesn't apply.
        // This check exists for embedders who register their own /health inside the plugin.
        if (routePath === '/health') return;

        const provided = req.headers['x-vailix-secret'] as string;
        const expected = options.secret;

        // Use timing-safe comparison to prevent timing attacks
        const isValid = provided &&
            provided.length === expected.length &&
            timingSafeEqual(Buffer.from(provided), Buffer.from(expected));

        if (!isValid) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }

        // Attestation check for report endpoint
        if (routePath === '/v1/report' && req.method === 'POST' && options.attestVerifier) {
            const token = req.headers['x-attest-token'] as string;
            if (!(await options.attestVerifier(token))) {
                return reply.code(403).send({ error: 'Attestation failed' });
            }
        }
    });

    // Create model with configurable TTL
    const { createKeyModel } = await import('./db.js');
    const KeyModel = createKeyModel(options.retentionDays ?? 14);

    registerRoutes(fastify, KeyModel);
};

export default fp(vailixPlugin, { name: '@vailix/drop' });

// 2. THE STANDALONE RUNNER (Plug & Play)
export async function startStandalone() {
    const server = Fastify({
        logger: true,
        disableRequestLogging: true, // SECURITY: Prevent default logging of IP/Headers
        bodyLimit: 5242880, // 5MB limit for large batched reports
    });

    if (!process.env.MONGODB_URI || !process.env.APP_SECRET) {
        console.error('Missing env vars: MONGODB_URI, APP_SECRET');
        process.exit(1);
    }

    // Read retention from env var, default to 14 days
    const retentionDays = process.env.VAILIX_RETENTION_DAYS
        ? parseInt(process.env.VAILIX_RETENTION_DAYS, 10)
        : 14;

    // Optional: Load Firebase Attestation
    let attestVerifier;
    if (process.env.ATTEST_PROVIDER === 'firebase') {
        const { firebaseAttestVerifier } = await import('./attest-firebase.js');
        attestVerifier = firebaseAttestVerifier;
    }

    server.register(vailixPlugin, {
        mongoUri: process.env.MONGODB_URI,
        secret: process.env.APP_SECRET,
        retentionDays: retentionDays,
        attestVerifier,
    });

    server.get('/health', async () => ({ status: 'ok' }));

    await server.listen({ port: Number(process.env.PORT) || 3000, host: '0.0.0.0' });
}

// Auto-start if run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startStandalone();
}

// Re-export types and utilities for library consumers
export { registerRoutes } from './routes';
export { KeyModel } from './db';
export type { AttestVerifier } from './attest';
