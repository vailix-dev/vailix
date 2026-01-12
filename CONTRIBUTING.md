# Contributing to Vailix

Thank you for your interest in contributing to Vailix! This document provides guidelines for contributing to the project.

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code.

## Development Setup

### Prerequisites

- Node.js >= 22.0.0
- pnpm >= 9.0.0

### Getting Started

```bash
# Clone the repository
git clone https://github.com/vailix-dev/vailix.git
cd vailix

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Project Structure

```
/vailix
  /packages/mask   - Mobile SDK (React Native/Expo)
  /packages/drop   - Backend Server (Fastify/MongoDB)
```

## Making Changes

### Branch Naming

- `feat/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(mask): add NFC pairing support
fix(drop): handle MongoDB connection timeout
docs: update installation instructions
```

### Pull Request Process

1. Fork the repository and create your branch from `main`
2. Make your changes and ensure tests pass
3. Update documentation if needed
4. Submit a pull request with a clear description

### Code Style

- Run `pnpm lint` before committing
- Run `pnpm format` to auto-format code
- Follow existing patterns in the codebase

## Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:cov

# Run tests in watch mode
pnpm test:watch
```

## Reporting Issues

### Bug Reports

Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Node version, etc.)

### Feature Requests

Describe:
- The problem you're trying to solve
- Your proposed solution
- Alternative approaches considered

## Security

**Do not open public issues for security vulnerabilities.**

Please report security issues privately to: security@vailix.dev

See [SECURITY.md](SECURITY.md) for our full security policy.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
