# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them privately to: **security@vailix.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fixes (optional)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity

### Disclosure Policy

We follow coordinated disclosure. We ask that you:
- Give us reasonable time to fix the issue before public disclosure
- Do not exploit the vulnerability beyond what's necessary for demonstration

## Security Design

Vailix is designed with privacy-first principles:

### Data Protection
- **Client-side encryption**: All metadata is encrypted with AES-256-GCM before leaving the device
- **Zero-knowledge server**: The server cannot decrypt user metadata
- **No IP logging**: Request logging is disabled by default

### Key Management
- Master keys are stored in device secure storage (Keychain/Keystore)
- Database encryption using SQLCipher (AES-256)

### Infrastructure Requirements
Deployments MUST:
- [ ] Use HTTPS/TLS termination
- [ ] Disable IP logging at all layers (reverse proxy, load balancer, cloud provider)
- [ ] Enable MongoDB authentication
- [ ] Use strong `APP_SECRET` values (min 32 characters)

See `core_framework_plan.md` for the complete security checklist.
