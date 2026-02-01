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

## Day 7: Observability & Quality Hardening

### What Changed

**Before (Day 6):**
- Console.log statements with no structure
- No way to trace a PR review end-to-end
- AI decisions not explained after the fact
- Low-quality AI output could reach GitHub
- No audit trail for incidents

**After (Day 7):**
- Structured JSON logging throughout pipeline
- Every PR review has unique `reviewId` for tracing
- Decision trace records why AI was allowed/blocked
- Review quality validation rejects boilerplate output
- Complete audit trail for post-incident analysis

### Observability Features

#### Structured Logging

All logs are JSON-formatted with consistent schema:
```json
{
  "timestamp": "2026-02-01T15:30:45.123Z",
  "level": "info",
  "reviewId": "a3f9c2d8e1b4",
  "phase": "ai_gating",
  "message": "AI review approved",
  "data": {
    "highRiskSignals": 2,
    "mediumRiskSignals": 1
  },
  "owner": "acme",
  "repo": "api-server",
  "pullNumber": 42
}
```

**Log Phases:**
- `pipeline_start` - PR processing begins
- `diff_extraction` - Diff fetched from GitHub
- `file_filtering` - Files ignored/analyzed
- `prechecks_complete` - Risk detection results
- `ai_gating` - AI approval decision
- `ai_invocation` - Claude API called
- `ai_response` - Claude response received
- `ai_validation` - Response validation
- `review_quality` - Quality check result
- `ai_review` - AI review accepted
- `ai_error` - AI failure
- `pipeline_complete` - Final trace logged

#### Decision Trace

Every PR review generates a decision trace that records:
```typescript
{
  reviewId: string;
  pipelinePath: 'silent_exit_safe' | 'ai_review' | 'manual_review_warning' | ...;
  aiGating: {
    allowed: boolean;
    reason: string;
    highRiskSignals: number;
    criticalCategories: string[];
  };
  preCheckSummary: {
    totalSignalsDetected: number;
    highConfidence: number;
    mediumConfidence: number;
  };
  aiInvoked: boolean;
  fallbackUsed: boolean;
  fallbackReason?: {
    trigger: 'api_error' | 'quality_rejection' | 'validation_error';
    details: string;
  };
  finalVerdict?: 'safe' | 'requires_changes' | ...;
  commentPosted: boolean;
}
```

**Logged at:** `pipeline_complete` phase

**Use cases:**
- Post-incident investigation: "Why didn't we review this PR?"
- Cost analysis: "How often is AI actually invoked?"
- Quality monitoring: "How often is AI output rejected?"
- Debugging: "What risk signals triggered manual review?"

#### Review Quality Validation

AI output is validated before posting to GitHub.

**Quality checks:**
1. **Boilerplate detection** - Rejects phrases like "looks good", "LGTM", "no issues"
2. **Minimum length** - Assessment must be >20 characters
3. **Minimum detail** - At least 1 item across risks/assumptions/recommendations
4. **Verdict consistency** - "safe" verdict cannot have risks; "high_risk" must have risks

**If quality check fails:**
- AI output discarded
- Fallback review generated from pre-checks
- Reason logged in decision trace
- Comment still posted (deterministic review)

**This prevents:**
- Generic "looks fine" AI reviews
- Low-signal output consuming user attention
- Silent quality degradation over time

### Determinism Guarantees

MergeSense has three layers of determinism:

#### Layer 1: Fully Deterministic (No AI)

**What:**
- File filtering (lock files, generated code)
- Pattern-based risk detection (regex matching)
- Risk signal confidence scoring
- AI gating decision logic

**Guarantee:**
Same diff → Same pre-check results → Same AI gating decision

**Why it matters:**
- Reproducible reviews
- Testable behavior
- No AI cost for trivial PRs

#### Layer 2: Constrained Nondeterminism (AI with Controls)

**What:**
- Claude API invocation (temperature=0 but not fully deterministic)
- Review generation

**Controls:**
- Structured JSON output enforced
- System prompt defines role/constraints
- Quality validation post-processing
- Fallback if output is low-quality

**Why it matters:**
- AI provides judgment, not randomness
- Output variability is bounded
- Quality floor is guaranteed

#### Layer 3: Nondeterministic Fallback (Acceptable)

**What:**
- AI unavailable (timeout, rate limit, API error)
- AI output rejected (quality check failed)

**Behavior:**
- Deterministic fallback review generated
- Based purely on pre-check results
- Always produces valid output

**Why it matters:**
- System never fails silently
- PRs always get reviewed (AI or deterministic)
- Degraded service is explicit, not hidden

### Why Temperature=0 Is Not Enough

**Common misconception:**
> "If temperature=0, the output is deterministic."

**Reality:**
- Temperature=0 reduces randomness but does not eliminate it
- Token sampling still has inherent nondeterminism
- Network/API variability affects responses
- Same prompt can yield slightly different outputs

**MergeSense approach:**
1. Use temperature=0 (reduces variability)
2. Enforce structured JSON output (constrains format)
3. Validate quality post-hoc (reject low-signal output)
4. Always have deterministic fallback (fail-safe)

**Result:**
Bounded nondeterminism with guaranteed quality floor.

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
| AI review fails quality check | Fallback review generated from pre-checks |

**MergeSense fails safely. No silent failures. No garbage output.**

## Debugging & Monitoring

### Tracing a PR Review

Every webhook includes a unique `reviewId` in the response:
```bash
curl -X POST https://your-domain.com/webhook \
  -H "X-GitHub-Event: pull_request" \
  -d '...'
  
# Response:
{
  "message": "Processing",
  "reviewId": "a3f9c2d8e1b4"
}
```

**Search logs by reviewId:**
```bash
cat logs.json | jq 'select(.reviewId == "a3f9c2d8e1b4")'
```

**Trace shows:**
- Diff extraction result
- Pre-check risk signals
- AI gating decision
- AI invocation (if applicable)
- Quality validation result
- Final verdict
- Comment posting confirmation

### Common Log Queries

**Find all AI fallbacks:**
```bash
cat logs.json | jq 'select(.phase == "ai_error")'
```

**Count reviews by pipeline path:**
```bash
cat logs.json | jq 'select(.phase == "pipeline_complete") | .data.trace.pipelinePath' | sort | uniq -c
```

**Find quality rejections:**
```bash
cat logs.json | jq 'select(.phase == "review_quality" and .level == "warn")'
```

**Token usage analysis:**
```bash
cat logs.json | jq 'select(.phase == "ai_response") | .data.input_tokens, .data.output_tokens'
```

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
│   ├── ai.ts                    # AI integration with quality validation
│   ├── ai-types.ts              # AI input/output types
│   ├── claude-client.ts         # Claude API client
│   ├── decision-trace.ts        # Decision recording
│   ├── prechecks.ts             # Deterministic risk detection
│   ├── review-quality.ts        # AI output validation
│   ├── risk-analyzer.ts         # Signal analysis
│   └── prompts/
│       └── review-prompt.ts     # AI prompt template
├── diff/
│   └── extractor.ts             # PR diff fetching
├── filters/
│   └── deterministic.ts         # File ignore patterns
├── github/
│   └── client.ts                # Installation token generation
├── observability/
│   └── logger.ts                # Structured logging
├── output/
│   ├── formatter.ts             # Review Markdown generation
│   └── publisher.ts             # GitHub comment API
├── pipeline/
│   └── orchestrator.ts          # Main processing flow with tracing
├── webhook/
│   └── handler.ts               # Webhook verification & routing
├── index.ts                     # Server entry point with logging context
└── types.ts                     # Core TypeScript interfaces
```

## Development Phases

- **Day 4**: Core pipeline (webhook → diff → filter → comment)
- **Day 5**: Enhanced deterministic pre-checks (10 categories, confidence scoring)
- **Day 6**: Real Claude AI integration (controlled judgment, fallback safety)
- **Day 7**: Observability & quality hardening (structured logging, decision trace, quality validation)

## Philosophy

MergeSense is built on the principle that **code review = decision review**.

It focuses on:
- Correctness over style
- Failure modes over happy paths
- Trade-offs over rules
- Silence over noise
- Restraint as seniority
- Explainability as accountability

Every line of code in MergeSense is written as if a Principal Engineer will be held accountable for it in production.

## Non-Goals

MergeSense intentionally does **not**:
- Enforce code style
- Rewrite code
- Generate boilerplate
- Act as a linter
- Support inline comments
- Provide configuration UI
- Persist data to databases
- Support multiple repos per installation (yet)

Simplicity and correctness matter more than features.

## Contributing

MergeSense is a build-in-public project demonstrating staff-level engineering judgment in system design.

Contributions should:
- Preserve architectural constraints
- Maintain fail-safe defaults
- Avoid adding complexity
- Be defensible in a design review
- Include structured logging
- Be traceable via decision trace

## License

MIT

## Acknowledgments

Built to demonstrate that AI code review tools can be:
- Deterministic where possible
- AI-assisted where necessary
- Cost-conscious by design
- Production-grade from day one
- Auditable in production
- Explainable after incidents