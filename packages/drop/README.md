# @vailix/drop

Backend server for Vailix proximity tracing. Stores reported keys and serves them to clients for matching.

## Installation

```bash
npm install @vailix/drop

# Optional: For Firebase Attestation
npm install firebase-admin
```

## Quick Start

### Standalone Server

```typescript
import { createVailixServer } from '@vailix/drop';

const server = await createVailixServer({
  database: process.env.DATABASE_URL!,
  appSecret: process.env.VAILIX_APP_SECRET!,
});

await server.listen({ port: 3000 });
```

### As Fastify Plugin

```typescript
import Fastify from 'fastify';
import { vailixPlugin } from '@vailix/drop';

const app = Fastify();

await app.register(vailixPlugin, {
  database: process.env.DATABASE_URL!,
  appSecret: process.env.VAILIX_APP_SECRET!,
  prefix: '/vailix', // Optional: mount under prefix
});

// Note: The plugin does NOT register a /health endpoint.
// Embedders must add their own health check as needed:
app.get('/health', async () => ({ status: 'ok' }));

await app.listen({ port: 3000 });
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mongoUri` | string | required | MongoDB connection string |
| `secret` | string | required | Shared secret (must match SDK) |
| `retentionDays` | number | 14 | Key retention period (auto-delete after N days) |
| `rateLimit.max` | number | 300 | Max requests per window |
| `rateLimit.windowMs` | number | 60000 | Rate limit window (ms) |

### Environment Variables

**Standalone Mode:**
```env
MONGODB_URI=mongodb://localhost:27017/vailix
APP_SECRET=your-secret-key
PORT=3000
HOST=0.0.0.0
VAILIX_RETENTION_DAYS=365  # Optional: Key retention in days (default: 14)
ATTEST_PROVIDER=firebase   # Optional: Enable Firebase Attestation
FIREBASE_PROJECT_ID=...    # Required if ATTEST_PROVIDER=firebase
GOOGLE_APPLICATION_CREDENTIALS=... # Required if ATTEST_PROVIDER=firebase
```

**Plugin Mode (configure via code):**
```typescript
app.register(vailixPlugin, {
    mongoUri: process.env.MONGODB_URI,
    secret: process.env.APP_SECRET,
    retentionDays: 365  // Configure here instead of env var
});
```

### Retention Policy

Keys are automatically deleted after `retentionDays` via MongoDB TTL index.

**Important**: Set `retentionDays` to match your app's longest exposure window.

**Examples**:
- STD tracing with 180-day Syphilis window: `retentionDays: 180`
- General contact tracing (14 days): `retentionDays: 14` (default)
- Apps with HPV (365 days): `retentionDays: 365`

## Health Checks

- **Standalone Mode**: A `/health` endpoint is automatically registered.
- **Plugin Mode**: The plugin does **NOT** register a `/health` endpoint. You must register your own health check route in your parent application if needed. The plugin is configured to bypass authentication for `/health` to support this.

## Deployment Security Checklist (MANDATORY)

To ensure user data remains unrecoverable even in a server breach, you **MUST** disable IP logging at every layer of your infrastructure.

- [ ] **App Level**: Ensure `fastify` is configured with `disableRequestLogging: true`.
- [ ] **Reverse Proxy**: Add `access_log off;` to Nginx/Apache configuration.
- [ ] **Cloud Provider**: Disable "Access Logs" or "Request Logs" in your cloud dashboard (AWS CloudWatch, Vercel Logs, etc.).
- [ ] **Load Balancer**: Disable access logging on load balancers (AWS ALB, Google Load Balancer).

> [!CRITICAL]
> Failure to disable IP logging allows an attacker to de-anonymize users by correlating public IP addresses with RPIs in the database.

## API Routes

### POST /v1/report

Submit positive report with encrypted RPIs.

**Headers:**
- `x-vailix-secret`: App secret (required)
- `x-attest-token`: Firebase App Check token (optional)

**Body:**
```json
{
  "reports": [
    {
      "rpi": "abc123...",
      "encryptedMetadata": "iv:tag:data"
    }
  ]
}
```

**Response:** `201 Created`

### GET /v1/download

Download reported keys for matching.

**Headers:**
- `x-vailix-secret`: App secret (required)

**Query Parameters:**
- `since`: Unix timestamp (ms) — only return keys reported after this time
- `cursor`: Pagination cursor for large result sets
- `format`: `json` or `bin` (binary format for efficiency)

> **Note:** When both `since` and `cursor` are provided, they are applied together (AND logic). The cursor continues pagination within the time boundary set by `since`.

**Response (JSON):**
```json
{
  "keys": [
    {
      "rpi": "abc123...",
      "metadata": "iv:tag:data",
      "reportedAt": 1704500000000
    }
  ],
  "nextCursor": "..."
}
```

When no more results are available, `nextCursor` is `null`.

**Response (Binary):**
- Header: `x-vailix-next-cursor` for pagination (empty string when no more results)
- Body: Compact binary format (16 bytes RPI + 8 bytes timestamp + variable metadata)

## Security Features

### Rate Limiting

Prevents abuse via configurable rate limits per IP.

### App Check Attestation

Optional Firebase App Check integration:

```typescript
```typescript
// Server verifies attestation only if ATTEST_PROVIDER=firebase is set
```

When enabled, requests without valid attestation tokens are rejected.

### Request Validation

All inputs are validated using TypeBox schemas:
- RPI must be exactly 32 **lowercase** hex characters (`a-f0-9` only, uppercase rejected)
- Metadata max size: 10KB
- Required headers enforced

## Deployment

### Docker

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Environment

```bash
docker run -d \
  -e DATABASE_URL=mongodb://mongo:27017/vailix \
  -e VAILIX_APP_SECRET=your-secret \
  -p 3000:3000 \
  your-image
```

## Database Schema

### Reports Collection

```typescript
{
  _id: ObjectId,
  rpi: Buffer,              // 16 bytes binary
  encryptedMetadata: string,
  reportedAt: Date,
  expiresAt: Date,          // Auto-delete after 14 days (TTL index)
}
```

Reports are automatically deleted after 14 days via MongoDB TTL index.

## License

MIT
