# @vailix/drop

Backend server for Vailix proximity tracing. Stores reported keys and serves them to clients for matching.

## Installation

```bash
npm install @vailix/drop
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

await app.listen({ port: 3000 });
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `database` | string | required | MongoDB connection string |
| `appSecret` | string | required | Shared secret (must match SDK) |
| `rateLimit.max` | number | 300 | Max requests per window |
| `rateLimit.windowMs` | number | 60000 | Rate limit window (ms) |

### Environment Variables

```env
DATABASE_URL=mongodb://localhost:27017/vailix
PORT=3000
HOST=0.0.0.0
VAILIX_APP_SECRET=your-secret-key
RATE_LIMIT_MAX=300
RATE_LIMIT_WINDOW_MS=60000
FIREBASE_PROJECT_ID=your-project-id  # Optional
```

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

**Response (Binary):**
- Header: `x-vailix-next-cursor` for pagination
- Body: Compact binary format (16 bytes RPI + 8 bytes timestamp + variable metadata)

## Security Features

### Rate Limiting

Prevents abuse via configurable rate limits per IP.

### App Check Attestation

Optional Firebase App Check integration:

```typescript
// Server verifies attestation automatically if FIREBASE_PROJECT_ID is set
```

When enabled, requests without valid attestation tokens are rejected.

### Request Validation

All inputs are validated using TypeBox schemas:
- RPI must be 32 hex characters
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
