# MergeSense Deployment Guide

## Prerequisites

- Node.js 18+ (LTS recommended)
- GitHub App created and configured
- Environment variables configured

---

## Platform-Specific Guides

### Railway

1. **Create new project** from GitHub repo

2. **Configure environment variables:**
   - `GITHUB_APP_ID`
   - `GITHUB_WEBHOOK_SECRET`
   - `GITHUB_PRIVATE_KEY` (base64 encoded)
   - `ANTHROPIC_API_KEY`
   - `REDIS_URL` (optional)
   - `MERGESENSE_POLICY_MODE`
   - `MERGESENSE_MAX_MEMORY_MB=512`
   - `MERGESENSE_MAX_RPM=60`

3. **Configure build settings:**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Node version: 18

4. **Enable health checks:**
   - Health check path: `/health`
   - Health check interval: 30s

5. **Scale configuration:**
   - Start with 1 instance
   - Monitor `/metrics` endpoint
   - Scale horizontally as needed

---

### Render

1. **Create new Web Service**

2. **Build settings:**
   - Build command: `npm install && npm run build`
   - Start command: `npm start`

3. **Environment variables:**
   - Add all required env vars
   - Set `NODE_ENV=production`
   - Set `PORT=3000` (Render manages this)

4. **Auto-restart:**
   - Enable auto-restart on crash
   - Set restart policy: Always

5. **Health checks:**
   - Path: `/health`
   - Success codes: 200

6. **Configure GitHub status check:**
   - In GitHub repo settings → Branches
   - Add required status check: `MergeSense Policy`

---

### Heroku

1. **Create new app:**
```bash
   heroku create mergesense-prod
```

2. **Set buildpack:**
```bash
   heroku buildpacks:set heroku/nodejs
```

3. **Configure environment:**
```bash
   heroku config:set GITHUB_APP_ID=...
   heroku config:set ANTHROPIC_API_KEY=...
   heroku config:set NODE_OPTIONS="--max-old-space-size=512"
```

4. **Enable dyno auto-restart:**
   - Use Eco or Basic dyno
   - Enable automatic restarts

5. **Add Redis (optional):**
```bash
   heroku addons:create heroku-redis:mini
```

6. **Deploy:**
```bash
   git push heroku main
```

---

## Post-Deployment Checklist

- [ ] `/health` endpoint returns 200
- [ ] `/metrics` endpoint accessible
- [ ] Webhook receiving events from GitHub
- [ ] Logs streaming correctly
- [ ] Memory usage under limit (check `/metrics`)
- [ ] Rate limiting working (run load test)
- [ ] Decision history populating (`/decisions`)
- [ ] Ledger chain valid (`/ledger/verify`)
- [ ] Merkle root computable (`/merkle/root`)
- [ ] Status checks posting to GitHub (if ENFORCE mode)

---

## Monitoring

### Key Metrics to Track

**From `/metrics` endpoint:**
- `memory.heapUsedMb` - Should stay under configured limit
- `prs.formallyValid` - Should be majority of total
- `prs.formallyInvalid` - Investigate if > 5%
- `contract.valid` - Must be `true`
- `invariants.fatalViolations` - Should be 0
- `postconditions.fatalViolations` - Should be 0

**Alerts to Configure:**
- Memory usage > 90% of limit
- Rate limit hit rate > 10%
- Formal validity rate < 95%
- Contract validation fails

---

## Scaling Guidelines

### Vertical Scaling
- Start: 512MB RAM
- Medium load: 1GB RAM
- High load: 2GB RAM

### Horizontal Scaling
- Enable Redis for distributed mode
- Use load balancer for multiple instances
- Each instance can handle ~50 PRs/hour

### Cost Optimization
- Start single-instance
- Enable Redis only when horizontal scaling
- Monitor `/metrics` for actual usage
- Scale based on `prs.loadShedPRSaturated`

---

## Troubleshooting

### Memory Limit Exceeded
```
memory_limit_exceeded - exiting
```
**Solution:** Increase `MERGESENSE_MAX_MEMORY_MB` or reduce `MERGESENSE_MAX_CONCURRENT`

### Rate Limit Issues
```
Rate limit exceeded
```
**Solution:** Increase `MERGESENSE_MAX_RPM` or add Redis for distributed rate limiting

### Contract Mismatch
```
Contract validation failed
```
**Solution:** Ensure code deployed matches `CURRENT_CONTRACT_VERSION`

### Ledger Chain Broken
```
Ledger chain verification failed
```
**Solution:** Check for Redis data corruption or manual tampering

---

## Security Hardening

1. **Environment variables:** Use platform's secret management
2. **Webhook secret:** Generate strong random value
3. **Private key:** Store securely, never commit
4. **API keys:** Rotate regularly
5. **HTTPS only:** Enforce TLS for all endpoints
6. **Rate limiting:** Keep `MERGESENSE_MAX_RPM` conservative

---

## Rollback Procedure

1. **Identify last known good version:**
```bash
   git log --oneline
```

2. **Revert to that commit:**
```bash
   git revert <commit-hash>
   git push origin main
```

3. **Platform auto-deploys** or trigger manual deploy

4. **Verify health:**
   - Check `/health`
   - Check `/metrics`
   - Verify contract version matches

---

## Support

- GitHub Issues: [repo]/issues
- Documentation: README.md
- Production Checklist: PRODUCTION_CHECKLIST.md