# Contributing to Aether OS

Thanks for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork the repo** and clone your fork
2. **Install dependencies**: `./scripts/setup.sh` (or `npm install` manually)
3. **Create a branch**: `git checkout -b my-feature`
4. **Make your changes** and test them
5. **Push** and open a Pull Request

## Development Setup

```bash
# UI only (mock mode, no kernel needed)
npm run dev

# Full stack (kernel + UI)
npm run dev:full

# Run tests
npx vitest run

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Build
npm run build
```

## Project Structure

| Directory | What it does |
|-----------|-------------|
| `components/` | React UI components (apps and OS layer) |
| `hooks/` | React hooks (agent bridge, mock loop) |
| `services/` | Kernel client, Gemini service, theme manager |
| `kernel/src/` | Kernel subsystems (process mgmt, filesystem, containers, etc.) |
| `runtime/src/` | Agent execution loop, tools, LLM providers |
| `server/src/` | HTTP/WS server, REST API routes |
| `shared/src/` | Typed protocol shared between frontend and backend |
| `sdk/src/` | TypeScript SDK client |
| `cli/src/` | CLI tool |

## Code Style

- **TypeScript** everywhere. No `any` unless absolutely necessary.
- **Prettier** for formatting (runs automatically via lint-staged on commit)
- **ESLint** for linting
- Keep changes focused. One PR per feature or fix.
- Don't add comments for self-evident code. Don't add docstrings to unchanged code.

## Pull Request Guidelines

- **Keep PRs small and focused** - easier to review, faster to merge
- **Write a clear title** - imperative mood, under 70 characters (e.g., "Add dark mode toggle to settings")
- **Describe what and why** in the PR body, not just what files changed
- **Test your changes** - run `npm run build` and `npx tsc --noEmit` at minimum
- **Don't break existing functionality** - if tests exist, they should pass

## What to Work On

- Check [Issues](../../issues) for open tasks
- Issues labeled `good first issue` are great starting points
- If you want to work on something not in Issues, open one first to discuss

## Commit Messages

Follow the existing style - short imperative summary, optional body for context:

```
Add VNC quality selector to desktop viewer

Allow users to switch between low/medium/high quality presets
when viewing graphical agent desktops via VNC.
```

## Reporting Bugs

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser/OS/Node version

## Security

If you find a security vulnerability, **do not open a public issue**. Email the maintainer directly.

Never commit API keys, passwords, or secrets. The `.env` file is gitignored for this reason.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
