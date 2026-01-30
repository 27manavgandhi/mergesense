# MergeSense Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          GitHub                                 │
│                                                                 │
│  Pull Request Event (opened/synchronize)                       │
│  └─> Webhook Payload (includes installation.id)               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTPS POST
                             │ (signature verified)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MergeSense Server                            │
│                  (Stateless Node.js App)                        │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 1. Webhook Handler                                        │ │
│  │    - Verify signature                                     │ │
│  │    - Extract installation_id from payload                 │ │
│  │    - Filter events (only PR opened/sync)                  │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 2. GitHub Client                                          │ │
│  │    - Generate installation token (on-demand)              │ │
│  │    - No caching, no persistence                           │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 3. Diff Extractor                                         │ │
│  │    - Fetch PR files via GitHub API                        │ │
│  │    - Enforce size limits (50 files, 5000 changes)         │ │
│  │    - Fail fast if too large                               │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 4. Deterministic Filter (NON-AI)                          │ │
│  │    - Ignore lock files, generated code, vendored deps     │ │
│  │    - Exit early if no meaningful changes                  │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 5. Pre-Check Analysis (NON-AI)                            │ │
│  │    - Pattern matching for:                                │ │
│  │      • Public API changes                                 │ │
│  │      • State mutation                                     │ │
│  │      • Auth/security boundaries                           │ │
│  │      • Persistence changes                                │ │
│  │      • Concurrency primitives                             │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 6. AI Judgment Layer (Controlled)                         │ │
│  │    - Invoked ONLY after pre-checks                        │ │
│  │    - Evaluates trade-offs and risks                       │ │
│  │    - Bounded token usage                                  │ │
│  │    - [Placeholder in Phase 1]                             │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 7. Review Formatter                                       │ │
│  │    - Structure output into standardized sections          │ │
│  │    - Single comment format                                │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │                                   │
│                            ▼                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ 8. Comment Publisher                                      │ │
│  │    - Post single review comment to PR                     │ │
│  │    - No inline comments                                   │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
└────────────────────────────┼─────────────────────────────────┘
                             │
                             │ GitHub API
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                          GitHub                                 │
│                                                                 │
│  Comment appears on Pull Request                               │
└─────────────────────────────────────────────────────────────────┘
```

## Event Flow: PR Opened → Comment Posted

### Step 1: PR Event Triggered
**Trigger**: Developer opens or updates a pull request  
**Data**: GitHub sends webhook with:
- PR metadata
- Repository info
- Installation ID
- Signature for verification

**Early Exit**: If event is not `pull_request` or action is not `opened`/`synchronize`

---

### Step 2: Webhook Verification
**Trigger**: POST request received at `/webhook`  
**Process**:
- Verify HMAC signature using webhook secret
- Extract installation ID from payload
- Validate required fields present

**Early Exit**: 
- Missing signature → 401
- Invalid signature → 401
- Missing installation ID → 400

---

### Step 3: Installation Token Generation
**Trigger**: Valid webhook processed  
**Process**:
- Use GitHub App credentials (App ID + Private Key)
- Request installation token for specific installation ID
- Token generated on-demand, not cached

**Early Exit**: 
- Missing App credentials → 500
- Token generation fails → error logged, process halts

---

### Step 4: Diff Extraction
**Trigger**: Authenticated client available  
**Process**:
- Fetch PR files via GitHub API
- Extract filename, status, additions, deletions, patch
- Enforce hard limits:
  - Max 50 files
  - Max 5000 total changes

**Early Exit**:
- PR too large → post warning comment, stop
- API failure → log error, stop

---

### Step 5: Deterministic Filtering
**Trigger**: Diff successfully extracted  
**Process**:
- Apply pattern matching to filter:
  - Lock files (package-lock.json, yarn.lock, etc.)
  - Generated files (*.min.js, *.generated.*, protobuf)
  - Vendored code (vendor/, node_modules/)
- Count files analyzed vs ignored

**Early Exit**:
- All files ignored → silent exit (no comment)
- No meaningful patches → silent exit

---

### Step 6: Pre-Check Analysis (Non-AI)
**Trigger**: Meaningful files remain after filtering  
**Process**:
- Pattern-based detection for:
  - New public APIs (`export`, `public`)
  - State mutations (`setState`, `state =`)
  - Auth changes (`auth`, `token`, `jwt`)
  - Persistence (`database`, `INSERT`, `UPDATE`)
  - Concurrency (`lock`, `mutex`, `async`)
  - Critical paths (filenames with `auth`, `payment`, etc.)
- Results stored as boolean flags

**No Early Exit**: Pre-checks always run, results feed into AI layer

---

### Step 7: AI Judgment (Controlled)
**Trigger**: Pre-checks completed  
**Process**:
- [Phase 1: Placeholder logic]
- Convert pre-check flags into risk statements
- Generate assumptions and recommendations
- Determine verdict (safe/safe_with_conditions/requires_changes/high_risk)

**Future**: Real AI integration with bounded token usage

**No Early Exit**: Always produces a review structure

---

### Step 8: Review Formatting
**Trigger**: Review data structure generated  
**Process**:
- Format into standardized Markdown sections:
  - High-Level Assessment
  - Key Engineering Risks
  - Assumptions Identified
  - Recommendations
  - Final Verdict
- Include metadata (files analyzed, files ignored)

**No Early Exit**: Always produces formatted output

---

### Step 9: Comment Publishing
**Trigger**: Formatted review ready  
**Process**:
- Post single comment to PR via GitHub Issues API
- Use installation token for authentication
- Comment appears as from GitHub App

**Early Exit**:
- API failure → logged but not retried (idempotency not critical for MVP)

---

### Step 10: Completion
**Result**: PR author sees MergeSense review comment  
**Logging**: Success logged with PR number

---

## Architectural Constraints

### Free-Tier Survivability
- No database required
- No message queue
- No background workers
- Can run on single free-tier Heroku/Railway/Render dyno
- Minimal memory footprint

### Stateless Design
- Installation tokens generated per request
- No cached state between requests
- Server restart has zero impact
- Horizontal scaling trivial (if needed later)

### Determinism Before AI
- File filtering: 100% deterministic
- Pre-checks: Pattern-based, no AI
- AI invoked only after deterministic stages pass
- Early exits prevent unnecessary AI calls

### Bounded AI Usage
- Pre-checks eliminate obviously safe PRs
- Size limits prevent runaway token usage
- Single comment format caps output tokens
- [Phase 1: AI layer is placeholder, no real usage yet]

### Failure-Safe Defaults
- Webhook signature failure → reject (never process unsigned)
- Missing installation ID → fail fast with 400
- PR too large → early exit with explanatory comment
- All files ignored → silent exit (no spam)
- API failures → logged and abandoned (no retry storm)
- Unknown errors → caught, logged, never crash server

---

## What This Architecture Explicitly Excludes

### No User Accounts
- GitHub App identity only
- No OAuth flow
- No user database
- No session management

### No Configuration UI
- Environment variables only
- No settings dashboard
- No per-repo customization (Phase 1)

### No Metrics/Observability (Phase 1)
- Basic console logging only
- No APM integration
- No custom metrics
- No alerting

### No Retry Logic
- Webhook failures logged, not retried
- Idempotency not enforced
- GitHub will retry webhooks automatically

### No Rate Limiting (Phase 1)
- Relies on GitHub webhook rate being reasonable
- No explicit backpressure mechanism

---

## Why This Architecture Works

1. **Simplicity**: 8 discrete components, clear data flow
2. **Correctness**: Deterministic behavior where possible
3. **Cost**: Zero infrastructure beyond compute
4. **Scale**: Stateless design handles multiple repos without code changes
5. **Debuggability**: Linear pipeline, easy to trace failures
6. **Maintainability**: Each component has single responsibility

This is a **staff-level architecture** that solves the stated problem without over-engineering.
