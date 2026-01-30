import { DiffFile, PreCheckResult, RiskSignal, DiffContext } from '../types.js';

const PUBLIC_API_PATTERNS = [
  { pattern: /\+.*export\s+(class|function|const|interface|type|enum)\s+(\w+)/g, confidence: 'high' as const },
  { pattern: /\+.*public\s+(class|interface|enum)\s+(\w+)/g, confidence: 'high' as const },
  { pattern: /\+.*pub\s+(fn|struct|enum|trait)\s+(\w+)/gm, confidence: 'high' as const },
  { pattern: /\+.*@(Public|Exposed|Api)/g, confidence: 'medium' as const },
];

const STATE_MUTATION_PATTERNS = [
  { pattern: /\+.*\bstate\s*=/g, confidence: 'high' as const },
  { pattern: /\+.*setState\(/g, confidence: 'high' as const },
  { pattern: /\+.*useState\(/g, confidence: 'medium' as const },
  { pattern: /\+.*useReducer\(/g, confidence: 'medium' as const },
  { pattern: /\+.*(\.set|\.update|\.patch|\.mutate)\(/g, confidence: 'medium' as const },
  { pattern: /\+.*\bthis\.\w+\s*=/g, confidence: 'medium' as const },
  { pattern: /\+.*global\s+\w+\s*=/g, confidence: 'high' as const },
];

const AUTH_PATTERNS = [
  { pattern: /\+.*(authenticate|authorize|login|logout|signIn|signOut)\(/gi, confidence: 'high' as const },
  { pattern: /\+.*(token|jwt|session|apikey|apiKey|credential|password|secret)\b/gi, confidence: 'high' as const },
  { pattern: /\+.*Authorization:/gi, confidence: 'high' as const },
  { pattern: /\+.*(auth|oauth|saml|oidc)/gi, confidence: 'medium' as const },
  { pattern: /\+.*(verify|validate|check).*(token|credential|auth)/gi, confidence: 'high' as const },
];

const PERSISTENCE_PATTERNS = [
  { pattern: /\+.*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s+(INTO|SET|FROM|TABLE|DATABASE)/gi, confidence: 'high' as const },
  { pattern: /\+.*(save|create|update|delete|destroy|upsert|findOrCreate)\(/gi, confidence: 'high' as const },
  { pattern: /\+.*(transaction|commit|rollback|begin|savepoint)/gi, confidence: 'high' as const },
  { pattern: /\+.*(Schema|Migration|Model)\./g, confidence: 'medium' as const },
  { pattern: /\+.*(\.query|\.exec|\.execute)\(/g, confidence: 'medium' as const },
];

const CONCURRENCY_PATTERNS = [
  { pattern: /\+.*(lock|mutex|semaphore|Lock|Mutex|Semaphore)\(/g, confidence: 'high' as const },
  { pattern: /\+.*(atomic|Atomic|AtomicInteger|AtomicBoolean)/g, confidence: 'high' as const },
  { pattern: /\+.*Promise\.(all|race|any|allSettled)\(/g, confidence: 'medium' as const },
  { pattern: /\+.*(async|await)\s/g, confidence: 'low' as const },
  { pattern: /\+.*(Thread|goroutine|spawn|fork|parallel)/g, confidence: 'high' as const },
  { pattern: /\+.*(channel|Channel|queue|Queue)/g, confidence: 'medium' as const },
];

const ERROR_HANDLING_PATTERNS = [
  { pattern: /\+.*catch\s*\(\s*\)\s*\{/g, confidence: 'high' as const },
  { pattern: /\+.*catch.*\{\s*\}/g, confidence: 'high' as const },
  { pattern: /\+.*\.catch\(\s*\)/g, confidence: 'high' as const },
  { pattern: /\+.*try\s*\{[^}]*\}\s*catch/g, confidence: 'medium' as const },
  { pattern: /-.*throw\s/g, confidence: 'medium' as const },
  { pattern: /\+.*panic\(/g, confidence: 'high' as const },
];

const NETWORKING_PATTERNS = [
  { pattern: /\+.*(fetch|axios|http|https|request|xhr|XMLHttpRequest)\(/gi, confidence: 'high' as const },
  { pattern: /\+.*(websocket|WebSocket|socket|Socket)/gi, confidence: 'high' as const },
  { pattern: /\+.*(timeout|Timeout|retry|Retry|backoff)/gi, confidence: 'medium' as const },
  { pattern: /\+.*(cors|CORS|origin|Origin)/gi, confidence: 'medium' as const },
];

const DEPENDENCY_PATTERNS = [
  { pattern: /\+.*import\s+.+\s+from\s+['"](?!\.)/g, confidence: 'low' as const },
  { pattern: /\+.*require\(['"](?!\.)/g, confidence: 'low' as const },
  { pattern: /package\.json.*"dependencies"/s, confidence: 'medium' as const },
];

const SECURITY_BOUNDARY_PATTERNS = [
  { pattern: /\+.*(sanitize|escape|validate|verify|check|guard)/gi, confidence: 'medium' as const },
  { pattern: /\+.*(eval|exec|system|shell|cmd)/gi, confidence: 'high' as const },
  { pattern: /\+.*(innerHTML|dangerouslySetInnerHTML)/g, confidence: 'high' as const },
  { pattern: /\+.*(deserialize|unserialize|parse|JSON\.parse)/g, confidence: 'medium' as const },
];

const CRITICAL_PATH_KEYWORDS = [
  'auth', 'payment', 'checkout', 'billing', 'security', 
  'critical', 'core', 'main', 'index', 'router', 'handler'
];

function createEmptySignal(): RiskSignal {
  return {
    detected: false,
    confidence: 'low',
    locations: [],
    details: [],
  };
}

function analyzePatterns(
  patches: Map<string, string>,
  patterns: Array<{ pattern: RegExp; confidence: 'high' | 'medium' | 'low' }>
): RiskSignal {
  const signal = createEmptySignal();
  const highConfidenceMatches: string[] = [];
  const mediumConfidenceMatches: string[] = [];
  const lowConfidenceMatches: string[] = [];

  for (const [filename, patch] of patches.entries()) {
    for (const { pattern, confidence } of patterns) {
      const matches = Array.from(patch.matchAll(pattern));
      if (matches.length > 0) {
        signal.detected = true;
        signal.locations.push(filename);
        
        matches.forEach(match => {
          const detail = match[0].replace(/^\+\s*/, '').trim();
          if (confidence === 'high') {
            highConfidenceMatches.push(detail);
          } else if (confidence === 'medium') {
            mediumConfidenceMatches.push(detail);
          } else {
            lowConfidenceMatches.push(detail);
          }
        });
      }
    }
  }

  if (highConfidenceMatches.length > 0) {
    signal.confidence = 'high';
    signal.details = highConfidenceMatches.slice(0, 3);
  } else if (mediumConfidenceMatches.length > 0) {
    signal.confidence = 'medium';
    signal.details = mediumConfidenceMatches.slice(0, 3);
  } else if (lowConfidenceMatches.length > 0) {
    signal.confidence = 'low';
    signal.details = lowConfidenceMatches.slice(0, 3);
  }

  signal.locations = [...new Set(signal.locations)];
  
  return signal;
}

function extractDiffContext(files: DiffFile[]): DiffContext {
  const addedLines: string[] = [];
  const removedLines: string[] = [];
  const modifiedFiles: string[] = [];
  const addedFiles: string[] = [];
  const removedFiles: string[] = [];

  for (const file of files) {
    if (file.status === 'added') {
      addedFiles.push(file.filename);
    } else if (file.status === 'removed') {
      removedFiles.push(file.filename);
    } else if (file.status === 'modified') {
      modifiedFiles.push(file.filename);
    }

    if (file.patch) {
      const lines = file.patch.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          addedLines.push(line);
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          removedLines.push(line);
        }
      }
    }
  }

  return { addedLines, removedLines, modifiedFiles, addedFiles, removedFiles };
}

function detectCriticalPathChanges(files: DiffFile[]): RiskSignal {
  const signal = createEmptySignal();
  
  for (const file of files) {
    const lowerFilename = file.filename.toLowerCase();
    for (const keyword of CRITICAL_PATH_KEYWORDS) {
      if (lowerFilename.includes(keyword)) {
        signal.detected = true;
        signal.confidence = 'high';
        signal.locations.push(file.filename);
        signal.details.push(`Critical path file: ${file.filename}`);
      }
    }
  }

  signal.locations = [...new Set(signal.locations)];
  signal.details = [...new Set(signal.details)];
  
  return signal;
}

export function runPreChecks(files: DiffFile[]): PreCheckResult {
  const patchMap = new Map<string, string>();
  
  for (const file of files) {
    if (file.patch) {
      patchMap.set(file.filename, file.patch);
    }
  }

  const context = extractDiffContext(files);

  return {
    publicAPI: analyzePatterns(patchMap, PUBLIC_API_PATTERNS),
    stateMutation: analyzePatterns(patchMap, STATE_MUTATION_PATTERNS),
    authentication: analyzePatterns(patchMap, AUTH_PATTERNS),
    persistence: analyzePatterns(patchMap, PERSISTENCE_PATTERNS),
    concurrency: analyzePatterns(patchMap, CONCURRENCY_PATTERNS),
    errorHandling: analyzePatterns(patchMap, ERROR_HANDLING_PATTERNS),
    networking: analyzePatterns(patchMap, NETWORKING_PATTERNS),
    dependencies: analyzePatterns(patchMap, DEPENDENCY_PATTERNS),
    criticalPath: detectCriticalPathChanges(files),
    securityBoundaries: analyzePatterns(patchMap, SECURITY_BOUNDARY_PATTERNS),
  };
}

export function shouldBlockAI(result: PreCheckResult): { block: boolean; reason?: string } {
  const highRiskSignals = Object.entries(result).filter(
    ([_, signal]) => signal.detected && signal.confidence === 'high'
  );

  if (highRiskSignals.length === 0) {
    return { block: true, reason: 'No high-risk signals detected - safe to skip AI' };
  }

  if (highRiskSignals.length > 5) {
    return { block: true, reason: 'Too many high-risk signals - requires manual review' };
  }

  return { block: false };
}
