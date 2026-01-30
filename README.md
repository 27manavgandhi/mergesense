# MergeSense

AI-assisted pull request review system focused on engineering judgment, not linting.

## Phase 1: Core Pipeline

This implementation includes:
- GitHub App webhook integration
- Diff extraction with size limits
- Deterministic file filtering
- Pattern-based pre-checks (non-AI)
- Placeholder AI judgment layer
- Single review comment output

## Prerequisites

- Node.js 18+
- GitHub App created with:
  - Webhook URL configured
  - Pull requests: Read & Write
  - Issues: Read & Write (for comments)
  - Webhook events: Pull request

## Setup

1. Create GitHub App at `https://github.com/settings/apps/new`

2. Configure:
   - Webhook URL: `https://your-domain.com/webhook`
   - Webhook secret: Generate strong random string
   - Permissions:
     - Pull requests: Read & Write
     - Issues: Read & Write
   - Subscribe to events: Pull request

3. Generate private key and download

4. Install app on target repository

5. Copy environment variables:
```bash
cp .env.example .env
```

6. Fill in `.env`:
```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret
PORT=3000
```

7. Install dependencies:
```bash
npm install
```

8. Run:
```bash
npm run dev
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for complete system design and event flow.

## Project Structure

```
src/
├── index.ts                    # Server entry point
├── types.ts                    # Core TypeScript interfaces
├── webhook/
│   └── handler.ts              # Webhook verification & routing
├── github/
│   └── client.ts               # Installation token generation
├── diff/
│   └── extractor.ts            # PR diff fetching
├── filters/
│   └── deterministic.ts        # File ignore patterns
├── analysis/
│   ├── prechecks.ts            # Pattern-based analysis (non-AI)
│   └── ai.ts                   # AI judgment placeholder
├── output/
│   ├── formatter.ts            # Review Markdown generation
│   └── publisher.ts            # GitHub comment posting
└── pipeline/
    └── orchestrator.ts         # Main processing flow
```

## How It Works

1. PR opened/updated → Webhook received
2. Signature verified, installation ID extracted
3. Installation token generated (on-demand, not cached)
4. Diff fetched from GitHub API
5. Files filtered (lock files, generated code ignored)
6. Pre-checks run (pattern matching for risks)
7. AI judgment generated (placeholder in Phase 1)
8. Single review comment posted to PR

## Design Constraints

- **Stateless**: No database, no cache, no persistence
- **Free-tier friendly**: Runs on single dyno/container
- **Deterministic filtering**: AI only after pattern-based checks
- **Bounded scope**: Max 50 files, 5000 changes per PR
- **Fail-fast**: Early exits prevent waste

## Next Steps (Future Phases)

- Phase 2: Real AI integration (Claude API)
- Phase 3: Enhanced pre-check detectors
- Phase 4: Cost optimization and monitoring

## Philosophy

MergeSense is not a linter. It evaluates engineering judgment embedded in PRs.

See master system prompt for full design philosophy.
