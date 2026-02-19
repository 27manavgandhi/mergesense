# MergeSense Production Checklist

## Pre-Deployment

### GitHub App Configuration
- [ ] GitHub App created
- [ ] Webhook URL configured (https://your-domain.com/webhook)
- [ ] Webhook secret generated and stored securely
- [ ] Private key downloaded and base64 encoded
- [ ] Permissions configured:
  - [ ] Pull requests: Read & Write
  - [ ] Commit statuses: Read & Write
  - [ ] Repository contents: Read
- [ ] App installed on target repositories

### Environment Variables
- [ ] `GITHUB_APP_ID` set
- [ ] `GITHUB_WEBHOOK_SECRET` set
- [ ] `GITHUB_PRIVATE_KEY` set (base64 encoded)
- [ ] `ANTHROPIC_API_KEY` set
- [ ] `NODE_ENV=production` set
- [ ] `PORT` configured (platform-specific)
- [ ] `REDIS_URL` set (if using distributed mode)

### Policy Configuration
- [ ] `MERGESENSE_POLICY_MODE` set (OFF/WARN/ENFORCE)
- [ ] `MERGESENSE_MAX_RISK_LEVEL` configured
- [ ] `MERGESENSE_MIN_CONFIDENCE` configured
- [ ] `MERGESENSE_ALLOW_MISALIGNED` configured
- [ ] `MERGESENSE_REPO_OVERRIDE_LIST` configured (if needed)

### Runtime Limits
- [ ] `MERGESENSE_MAX_MEMORY_MB` set appropriately
- [ ] `MERGESENSE_MAX_RPM` configured
- [ ] `MERGESENSE_MAX_CONCURRENT` configured

---

## Deployment

### Platform Setup
- [ ] Platform account created (Railway/Render/Heroku)
- [ ] Project/app created
- [ ] GitHub repo connected
- [ ] Auto-deploy configured
- [ ] Build command verified
- [ ] Start command verified

### Health & Monitoring
- [ ] Health check endpoint configured (`/health`)
- [ ] Health check passing
- [ ] Logs streaming enabled
- [ ] Log retention configured
- [ ] Metrics endpoint accessible (`/metrics`)

---

## Post-Deployment Verification

### Functional Tests
- [ ] `/health` returns 200 OK
- [ ] `/metrics` returns valid JSON
- [ ] `/decisions` endpoint accessible
- [ ] `/ledger/verify` shows valid chain
- [ ] `/merkle/root` computes successfully
- [ ] Webhook receives GitHub events

### Integration Tests
- [ ] Open test PR in configured repo
- [ ] Webhook received and processed
- [ ] Review comment posted
- [ ] Risk score displayed
- [ ] Verdict confidence shown
- [ ] Status check posted (if WARN/ENFORCE mode)
- [ ] Decision record created (`/decisions`)

### Security Validation
- [ ] Webhook signature verification working
- [ ] Rate limiting active (test with load script)
- [ ] Memory guard functional
- [ ] No sensitive data in logs
- [ ] HTTPS enforced
- [ ] Secrets properly masked in platform UI

---

## GitHub Repository Configuration

### Branch Protection
- [ ] Branch protection rule created for main/master
- [ ] Required status checks enabled
- [ ] "MergeSense Policy" added as required check (if ENFORCE mode)
- [ ] Require branches to be up to date before merging
- [ ] Dismiss stale pull request approvals

### Webhook Validation
- [ ] Webhook delivery history shows successful deliveries
- [ ] Recent deliveries show 200 OK responses
- [ ] Payload signature validation passing

---

## Performance & Stability

### Load Testing
- [ ] Run load test script: `node scripts/load-test.js`
- [ ] Verify rate limiting triggers at configured RPM
- [ ] Memory usage stays under limit
- [ ] Response times acceptable (<5s per PR)
- [ ] No crashes under load

### Operational Metrics
- [ ] Memory usage < 80% of limit
- [ ] Rate limit hit rate < 5%
- [ ] Formally valid rate > 95%
- [ ] No fatal invariant violations
- [ ] No fatal postcondition violations
- [ ] Contract validation always passes

---

## Monitoring Setup

### Alerts to Configure
- [ ] Memory usage > 90% of limit
- [ ] Rate limit exceeded > 10 times/hour
- [ ] Formal validity rate < 90%
- [ ] Contract validation failure
- [ ] Health check failure
- [ ] Webhook delivery failure rate > 10%

### Dashboards to Create
- [ ] PR processing throughput
- [ ] Risk score distribution
- [ ] Verdict confidence distribution
- [ ] Policy violation rate
- [ ] Memory usage over time
- [ ] Rate limit hits over time

---

## Documentation

- [ ] Deployment guide reviewed
- [ ] Environment variables documented
- [ ] Rollback procedure documented
- [ ] Incident response plan created
- [ ] Team trained on system operation

---

## Sign-Off

- [ ] Development team approved
- [ ] Security team reviewed
- [ ] Operations team trained
- [ ] Stakeholders notified
- [ ] Production launch approved

---

## Post-Launch (First 24 Hours)

- [ ] Monitor error rates
- [ ] Review first 10 PR reviews
- [ ] Check decision ledger integrity
- [ ] Verify Merkle chain
- [ ] Collect developer feedback
- [ ] Adjust thresholds if needed

## Post-Launch (First Week)

- [ ] Analyze risk score distribution
- [ ] Review policy violation patterns
- [ ] Tune confidence thresholds
- [ ] Optimize memory usage
- [ ] Document common issues
- [ ] Update runbooks