# MergeSense

**AI-assisted pull request review focused on engineering judgment, not linting.**

MergeSense is a GitHub App that evaluates the engineering decisions embedded in pull requests before merge. It combines deterministic pre-checks with controlled AI analysis to surface risks, assumptions, and trade-offs that matter in production.

## What MergeSense Is

MergeSense reviews **engineering judgment**, not code style.

It exists to answer:
- Is the logic correct under all reasonable conditions?
- What assumptions does this code rely on?
- What breaks under scale, failure, or misuse?
- What trade-offs were made (explicitly or implicitly)?
- Is this code safe to own and evolve long-term?

## What MergeSense Is NOT

- ❌ Not a linter
- ❌ Not a formatter
- ❌ Not a style enforcer
- ❌ Not a beginner code tutor
- ❌ Not a feature checklist generator

MergeSense writes reviews as if a Staff/Principal Engineer is personally accountable for the code.

## Architecture Overview
```
PR Opened
  ↓
Webhook Received → Signature Verified
  ↓
Installation Token Generated (on-demand, no cache)
  ↓
Diff Extracted (max 50 files, 5000 changes)
  ↓
Files Filtered (lock files, generated code removed)
  ↓
Deterministic Pre-Checks Run (10 risk categories, 50+ patterns)
  ↓
Risk Analysis
  ↓
AI Decision:
  • 0 high signals → Silent exit (safe PR)
  • 1-5 high signals → AI review (Claude)
  • 6+ high signals → Manual review warning
  ↓
Review Generated (AI or fallback)
  ↓
Single Comment Posted to PR
```

## Day 6: Real Claude AI Integration

### What Changed

**Before (Day 5):**
- AI layer was a placeholder
- Generated review from pre-check flags only
- No actual AI calls

**After (Day 6):**
- Real Claude API integration (Sonnet 4)
- Structured JSON output enforced
- Defensive response validation
- Fallback to deterministic review if AI fails
- Token usage logging

### AI Safeguards

AI is **only** invoked when:
1. Deterministic pre-checks detect 1-5 high-confidence risk signals
2. Risk analyzer approves AI usage
3. PR is not trivially safe (0 high signals)
4. PR is not extremely risky (6+ high signals)

AI **never** runs for:
- Safe PRs with no significant risks
- Extremely risky PRs requiring manual review
- PRs that fail deterministic filters

### What Happens If AI Fails

If Claude API fails (timeout, rate limit, malformed response):
1. Error is logged
2. Fallback review generated from deterministic pre-checks
3. PR comment posted with caveat: "AI review unavailable"
4. Verdict determined by pre-check confidence levels
5. System remains operational

**MergeSense never fails silently. Failures are explicit.**

## Risk Detection (Deterministic Pre-Checks)

MergeSense detects 10 categories of engineering risk:

1. **Public API Changes** - New exports, breaking changes
2. **State Mutations** - setState, global variables, class properties
3. **Authentication** - Login logic, tokens, sessions, credentials
4. **Persistence** - Database operations, transactions, schema changes
5. **Concurrency** - Locks, mutexes, async patterns, race conditions
6. **Error Handling** - Empty catch blocks, swallowed errors
7. **Networking** - HTTP calls, WebSockets, timeouts, retries
8. **Dependencies** - New imports, package.json changes
9. **Security Boundaries** - eval, innerHTML, deserialization, validation
10. **Critical Paths** - Files containing auth, payment, security logic

Each detection includes:
- **Confidence level** (high/medium/low)
- **File locations**
- **Code examples**

## Prerequisites

- Node.js 18+
- GitHub App with:
  - Webhook configured
  - Pull requests: Read & Write
  - Issues: Read & Write (for comments)
  - Webhook events: Pull request
- Anthropic API key

## Setup

### 1. Create GitHub App

Navigate to: `https://github.com/settings/apps/new`

Configure:
- **Webhook URL**: `https://your-domain.com/webhook`
- **Webhook secret**: Generate strong random string
- **Permissions**:
  - Pull requests: Read & Write
  - Issues: Read & Write
- **Subscribe to events**: Pull request

Generate private key and download.

### 2. Get Anthropic API Key

1. Sign up at https://console.anthropic.com
2. Generate API key
3. Note: Free tier has rate limits

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment
```bash
cp .env.example .env
```

Edit `.env`:
```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your_webhook_secret
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

**Important**: 
- `GITHUB_PRIVATE_KEY` must include literal `\n` characters (not actual newlines)
- `ANTHROPIC_API_KEY` starts with `sk-ant-`

### 5. Install App on Repository

Install your GitHub App on target repository.

### 6. Run

Development:
```bash
npm run dev
```

Production:
```bash
npm run build
npm start
```

Server starts on port 3000, webhook ready at `/webhook`.

## How It Works

### Event Flow

1. **PR opened or updated** → GitHub sends webhook
2. **Signature verification** → Reject if invalid
3. **Installation ID extraction** → From webhook payload (stateless)
4. **Installation token generation** → On-demand, not cached
5. **Diff extraction** → Fetch PR files, enforce size limits
6. **File filtering** → Remove lock files, generated code, vendor code
7. **Deterministic pre-checks** → Pattern-based risk detection
8. **Risk analysis** → Count signals by confidence level
9. **AI decision**:
   - 0 high signals → Skip AI, silent exit
   - 1-5 high signals → Call Claude API
   - 6+ high signals → Skip AI, post manual review warning
10. **Review generation** → AI or fallback
11. **Comment posted** → Single PR comment

### Cost Optimization

**Token usage is minimized by:**
- Early exits for safe PRs (no AI call)
- Early exits for extremely risky PRs (no AI call)
- Size limits on diffs (max 50 files, 5000 changes)
- Deterministic filtering removes noise
- AI only runs on 50-60% of PRs
- Estimated 40-50% cost reduction vs always-on AI

### Failure Modes

**What happens when things fail:**

| Failure | Behavior |
|---------|----------|
| Invalid webhook signature | 401 response, no processing |
| Missing installation ID | 400 response, logged |
| PR too large (>50 files or >5000 changes) | Warning comment posted, processing stops |
| All files filtered (lock files only) | Silent exit, no comment |
| GitHub API failure | Error logged, warning comment posted |
| Claude API timeout | Fallback review generated from pre-checks |
| Claude returns malformed JSON | Fallback review generated from pre-checks |
| Claude API rate limit | Fallback review generated from pre-checks |

**MergeSense fails safely. No silent failures. No garbage output.**

## Design Constraints

### Stateless Architecture
- No database
- No Redis/cache
- No queues
- No background workers
- Installation tokens generated per request
- Server restart has zero impact

### Free-Tier Survivability
- Runs on single Heroku/Railway/Render dyno
- Minimal memory footprint
- No infrastructure dependencies
- AI gated to reduce costs

### Determinism First
- File filtering: 100% pattern-based
- Pre-checks: Regex detection, no ML
- AI invoked only after deterministic approval
- Reproducible results for same diff

### Bounded Scope
- Max 50 files per PR
- Max 5000 total changes per PR
- Single comment output only
- No inline comments
- No configurability (by design)

## Project Structure
```
src/
├── analysis/
│   ├── ai.ts                    # AI integration with fallback
│   ├── ai-types.ts              # AI input/output types
│   ├── claude-client.ts         # Claude API client
│   ├── prechecks.ts             # Deterministic risk detection
│   ├── risk-analyzer.ts         # Signal analysis
│   └── prompts/
│       └── review-prompt.ts     # AI prompt template
├── diff/
│   └── extractor.ts             # PR diff fetching
├── filters/
│   └── deterministic.ts         # File ignore patterns
├── github/
│   └── client.ts                # Installation token generation
├── output/
│   ├── formatter.ts             # Review Markdown generation
│   └── publisher.ts             # GitHub comment API
├── pipeline/
│   └── orchestrator.ts          # Main processing flow
├── webhook/
│   └── handler.ts               # Webhook verification & routing
├── index.ts                     # Server entry point
└── types.ts                     # Core TypeScript interfaces
```

## Development Phases

- **Day 4**: Core pipeline (webhook → diff → filter → comment)
- **Day 5**: Enhanced deterministic pre-checks (10 categories, confidence scoring)
- **Day 6**: Real Claude AI integration (controlled judgment, fallback safety)

## Philosophy

MergeSense is built on the principle that **code review = decision review**.

It focuses on:
- Correctness over style
- Failure modes over happy paths
- Trade-offs over rules
- Silence over noise
- Restraint as seniority

Every line of code in MergeSense is written as if a Principal Engineer will be held accountable for it in production.

## Non-Goals

MergeSense intentionally does **not**:
- Enforce code style
- Rewrite code
- Generate boilerplate
- Act as a linter
- Support inline comments
- Provide configuration UI
- Track metrics (Day 6)
- Support multiple repos per installation (yet)

Simplicity and correctness matter more than features.

## Contributing

MergeSense is a build-in-public project demonstrating staff-level engineering judgment in system design.

Contributions should:
- Preserve architectural constraints
- Maintain fail-safe defaults
- Avoid adding complexity
- Be defensible in a design review

## License

MIT

## Acknowledgments

Built to demonstrate that AI code review tools can be:
- Deterministic where possible
- AI-assisted where necessary
- Cost-conscious by design
- Production-grade from day one