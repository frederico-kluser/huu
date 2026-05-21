// Security-audit pipeline. OWASP Top 10:2021 + CWE Top 25 (2024) +
// dependency CVE scan + secrets sweep. REPORT-ONLY.
//
// References:
// - OWASP Top 10: https://owasp.org/Top10/2021/
// - OWASP Cheat Sheet Series (per-category prevention): https://cheatsheetseries.owasp.org/IndexTopTen.html
// - CWE Top 25 2024: https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html
// - Secrets scanning tools: gitleaks, trufflehog, detect-secrets.

import type { Pipeline } from '../types.js';

export const DEFAULT_PIPELINE_FILENAME = 'huu-security-audit.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Security Audit';

const STEP1_PROMPT = `You are huu's security-audit bootstrap agent. Goal: detect the stack, make ephemeral security scanners available, write \`.huu/audits/security.md\` scaffold, initialize \`.huu/audits/security-faq.json\`.

=== STEP 0 — REPORT-ONLY HARD RULE ===
You may NOT modify any file in the repo OTHER than the audit artifacts under \`.huu/audits/\` (and \`.huu/audits/.tmp/\` for working files). If a tool requires installation, use \`npx --yes <tool>\` (Node), \`pipx run <tool>\` (Python), or vendored binaries under \`$HOME/.huu/bin/\`. NEVER touch package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, lockfiles, or any production source. Create the output directory with \`mkdir -p .huu/audits/.tmp/security\` before writing.

=== STEP 1 — Detect the stack and manifest files ===
Identify presence of:
- \`package.json\` (npm/yarn/pnpm) + lockfiles.
- \`requirements*.txt\`, \`pyproject.toml\`, \`Pipfile.lock\`.
- \`Cargo.toml\` + \`Cargo.lock\`.
- \`go.mod\` + \`go.sum\`.
- \`pom.xml\`, \`build.gradle\` (Maven/Gradle).
- \`Gemfile.lock\`.
- \`composer.lock\`.

Identify the source languages by file extension count (similar to the Quality Audit pipeline's step 1).

=== STEP 2 — Best-effort tool install ===
Each install attempt is independent; STOP at first success per tool family; NEVER \`sudo\`. If all install attempts for a tool family fail, append an info-severity FAQ finding and continue with grep heuristics.

**Secret scanning**
- \`gitleaks version\` — already installed?
- \`brew install gitleaks\` (mac/linuxbrew).
- \`curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/.github/install.sh | sh -s -- -b /tmp/huu-bin\` (vendored install).
- Fallback: \`npx --yes @gitleaks/cli@latest version\` if a node wrapper exists.
- Else \`pipx install detect-secrets\`.

**SAST**
- \`pipx install semgrep\` (or \`brew install semgrep\`).
- If install succeeds, use ruleset \`p/owasp-top-ten\` (or \`p/security-audit\`).

**Dependency CVE**
- Node: \`npm audit\` (built-in; just need lockfile).
- Python: \`pipx install pip-audit\`.
- Rust: \`cargo install --locked cargo-audit\`.
- Go: \`go install golang.org/x/vuln/cmd/govulncheck@latest\`.
- Cross-language: \`pipx install osv-scanner\` (Google OSV).

=== STEP 3 — Write .huu/audits/security.md scaffold ===
Path: \`./.huu/audits/security.md\`.

# .huu/audits/security.md — Security audit

> Report-only audit aligned to OWASP Top 10:2021 + CWE Top 25 (2024) + dependency CVEs + secret-leak scan. No code was modified.
> References: https://owasp.org/Top10/2021/ ; https://cheatsheetseries.owasp.org/IndexTopTen.html ; https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html

## 1. Scope
- Stack detected: <languages>
- Manifests found: <list>
- Tools active: <list>
- Tools unavailable: <list with reasons>

## 2. Secrets sweep
(filled in by step 2)

## 3. OWASP Top 10 per-file findings
(filled in by step 3)

## 4. Dependency CVEs
(filled in by step 4)

## 5. Summary by severity
(filled in by step 5)

## 6. Remediation roadmap
(filled in by step 5)

=== STEP 4 — Initialize .huu/audits/security-faq.json ===
Schema:
\`\`\`json
{ "summary": "<=256>", "knowledge": "<=5000>", "path": "<file or 'global'>", "category": "secret|owasp-a01|owasp-a02|owasp-a03|owasp-a04|owasp-a05|owasp-a06|owasp-a07|owasp-a08|owasp-a09|owasp-a10|cve|misc", "cwe_id": "CWE-XXX or null", "severity": "info|warn|critical", "cheatsheet": "<URL>" }
\`\`\`

=== HARD RULES ===
- DO NOT modify production source code.
- DO NOT exfiltrate any secrets you find — redact them in findings (first 4 + last 4 chars only).
- DO NOT call external services beyond the listed scanners (e.g. don't curl arbitrary URLs from secrets).`;

const STEP2_PROMPT = `You are at step 2 — secrets sweep (whole-project). Goal: find committed secrets in current files AND in git history, redact them, append findings, populate section "2. Secrets sweep" of \`.huu/audits/security.md\`. NO code changes.

=== STEP 1 — Run gitleaks (preferred) ===
If gitleaks is available:
\`\`\`bash
gitleaks detect --redact --report-format json --report-path ./.huu/audits/.tmp/security/gitleaks.json --no-banner
\`\`\`

Add \`--source .\` if the repo isn't the cwd.

Also scan git history:
\`\`\`bash
gitleaks detect --redact --report-format json --report-path ./.huu/audits/.tmp/security/gitleaks-history.json --no-banner --log-opts="--all"
\`\`\`

Parse the JSON reports.

=== STEP 2 — Fallback grep patterns (if gitleaks unavailable) ===
Search across the working tree (skipping \`.git\`, \`node_modules\`, \`dist\`, \`build\`, \`vendor\`, \`target\`) for high-signal regexes:

- AWS access key: \`\\bAKIA[0-9A-Z]{16}\\b\`.
- AWS secret key: \`\\b[A-Za-z0-9/+=]{40}\\b\` (high false-positive; require co-located \`aws_secret_access_key\`).
- GitHub PAT: \`\\bghp_[A-Za-z0-9]{36}\\b\`.
- GitHub fine-grained PAT: \`\\bgithub_pat_[A-Za-z0-9_]{82}\\b\`.
- Slack bot token: \`\\bxox[baprs]-\\d+-\\d+-[A-Za-z0-9]+\\b\`.
- Private RSA / SSH keys: \`-----BEGIN (RSA |OPENSSH |DSA |EC )?PRIVATE KEY-----\`.
- Generic high-entropy assignment near \`SECRET|TOKEN|KEY|PASSWORD\`: regex \`(?i)(secret|token|key|password)\\s*[:=]\\s*["'][A-Za-z0-9+/=_-]{16,}["']\`.

Redaction format in findings: \`AKIA1234...XYZ8\` (first 4 + last 4 chars).

=== STEP 3 — Append findings ===
For each match:
\`\`\`json
{ "summary": "Possible AWS access key in src/config.ts:42 (AKIA1234...XYZ8)", "knowledge": "<file path, line, regex that matched, redacted secret>", "path": "src/config.ts", "category": "secret", "cwe_id": "CWE-798", "severity": "critical", "cheatsheet": "https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html" }
\`\`\`

Severity = critical for any plausible secret, warn for ambiguous matches (e.g. anything caught by the generic high-entropy regex without an AWS/GitHub prefix).

=== STEP 4 — Update section "2. Secrets sweep" of .huu/audits/security.md ===

\`\`\`
Tool used: <gitleaks | grep heuristics>
Working-tree findings: <N>
Git-history findings: <M> (history scan: <ran | skipped>)
Top findings:
| Severity | Location | Type | Redacted match |
|---|---|---|---|
| critical | src/config.ts:42 | AWS access key | AKIA...XYZ8 |
| ... | | | |
\`\`\`

=== Cleanup ===
- Delete \`./.huu/audits/.tmp/security/gitleaks.json\` and \`./.huu/audits/.tmp/security/gitleaks-history.json\` after parsing.

=== HARD RULES ===
- ALL secrets must be redacted (first 4 + last 4 chars only). Never write a full secret to the report.
- DO NOT attempt to "validate" found secrets by calling the related service.
- DO NOT remove the secrets from source files in this step (that's a remediation decision for a human).`;

const STEP3_PROMPT = `You are at step 3 — OWASP Top 10 per-file sweep for \`$file\`. Goal: scan \`$file\` for OWASP Top 10:2021 patterns, append findings to \`.huu/audits/security-faq.json\`. NO code changes.

=== STEP 0 — SCOPE NOTE + SKIP RULE ===
This step spawns one agent per selected file. The pipeline caps total nodes at \`maxNodeExecutions: 50\` (~45 files on a 5-step pipeline). If you are auditing a larger repo, narrow your file selection with Smart Select in the file picker.

SKIP IMMEDIATELY (no findings, no FAQ append) if \`$file\` matches: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`.

=== OWASP Top 10:2021 checklist ===
For each category, the patterns to flag in \`$file\`. Where Semgrep is available (check .huu/audits/security.md section 1), prefer running \`semgrep --config p/owasp-top-ten "$file"\` and merge with the heuristic findings below.

**A01 — Broken Access Control** (CWE-284, CWE-285, CWE-639)
- HTTP handlers that read a user-supplied ID and return data without an authz check (\`req.params.id\`, \`request.GET['id']\` going straight into DB without a "current user owns this" check).
- IDOR signals: \`/api/users/:id\` patterns where the handler doesn't verify ownership.
- Hardcoded role bypass: \`if (user.email === "admin@*")\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

**A02 — Cryptographic Failures** (CWE-327, CWE-329, CWE-330)
- Weak hashes: \`md5(\`, \`sha1(\`, \`crypto.createHash("md5")\`, \`hashlib.md5\`.
- Weak ciphers: \`DES\`, \`3DES\`, \`RC4\`, \`AES.*ECB\`.
- Hardcoded keys / IVs / salts (string literals near \`createCipheriv\`, \`Cipher(key=\`).
- TLS misconfiguration: \`rejectUnauthorized: false\`, \`verify=False\`, \`InsecureSkipVerify: true\`, \`TLSv1\`/\`TLSv1.1\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

**A03 — Injection** (CWE-79, CWE-89, CWE-78, CWE-94)
- SQL: string concatenation / template literals with raw values into queries (\`query("SELECT * FROM users WHERE id=" + id)\`, f-string SQL).
- OS Command: \`exec\`, \`spawn\`, \`shell=True\`, \`os.system(...)\` with user input.
- XSS: \`innerHTML =\`, \`dangerouslySetInnerHTML\`, \`document.write(\`, \`v-html\`, Django \`mark_safe\` on user input.
- Code injection: \`eval(\`, \`Function(\`, \`new Function(\`, Python \`exec(\`, Ruby \`eval(\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html

**A04 — Insecure Design** (CWE-209, CWE-256, CWE-501)
- Hard to spot statically; flag suspicious comments like \`TODO: add auth\`, \`FIXME: trust user input\`, \`HACK: skip validation\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html

**A05 — Security Misconfiguration** (CWE-16, CWE-2)
- \`DEBUG = True\` (Django/Flask) in production config files.
- Open CORS: \`Access-Control-Allow-Origin: *\` combined with \`Access-Control-Allow-Credentials: true\`.
- Default credentials: \`password = "password"\`, \`admin/admin\`.
- Detailed error pages leaked: \`stack=err.stack\` returned to response.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html

**A06 — Vulnerable and Outdated Components** (CWE-1104)
- This is mostly the job of step 4 (CVE scan). At per-file level, flag manual fetches from unpinned CDNs: \`<script src="https://cdn.../latest/...">\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html

**A07 — Identification and Authentication Failures** (CWE-287, CWE-307)
- Plain text password storage: \`user.password = body.password\` without a hash function.
- Weak password validation: regex allowing short or trivial passwords.
- Session cookies without \`httpOnly\` / \`secure\` / \`SameSite\`.
- Missing rate limit middleware on \`/login\` / \`/auth\` routes.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

**A08 — Software and Data Integrity Failures** (CWE-502)
- Unsafe deserialization: \`pickle.load\`, \`yaml.load\` (without \`SafeLoader\`), \`Marshal.load\`, \`ObjectInputStream.readObject\`, \`JSON.parse\` of attacker-controlled input feeding \`new Function\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

**A09 — Security Logging and Monitoring Failures** (CWE-778)
- Logging that includes PII or secrets: \`logger.info("user: \\\${user}")\` where \`user\` includes password / token field.
- Missing audit trail on sensitive ops: \`deleteUser\`, \`grantAdmin\`, etc. without a log line.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

**A10 — Server-Side Request Forgery** (CWE-918)
- User-controlled URL into a server-side fetch: \`fetch(req.body.url)\`, \`requests.get(request.GET['url'])\`, \`HttpClient.GetAsync(userUrl)\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

=== STEP 1 — Read inputs ===
- \`./.huu/audits/security.md\` (note which tools are available).
- \`./.huu/audits/security-faq.json\`.
- \`$file\`.

=== STEP 2 — Run Semgrep on \`$file\` if available ===
\`\`\`bash
semgrep --config p/owasp-top-ten --json "$file" > ./.huu/audits/.tmp/security/semgrep.json
\`\`\`
Parse the JSON and merge findings.

=== STEP 3 — Run the OWASP heuristics above ===
For EACH match across all 10 categories:
\`\`\`json
{ "summary": "$file:<line>: A03 Injection — SQL string concat", "knowledge": "<the offending code, why it's flagged, link to OWASP Cheat Sheet>", "path": "$file", "category": "owasp-a03", "cwe_id": "CWE-89", "severity": "warn|critical", "cheatsheet": "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html" }
\`\`\`

Severity rules:
- critical: confirmed injection vector or hardcoded secret-like pattern OR plain-text password persistence.
- warn: pattern is suspect but needs human confirmation (e.g. \`innerHTML =\` might be safe if input is already escaped).
- info: low-confidence patterns (\`TODO: add auth\` style).

=== Cleanup ===
- Delete \`./.huu/audits/.tmp/security/semgrep.json\` after parsing.

=== HARD RULES ===
- DO NOT modify \`$file\` or any other file.
- Append-only to FAQ (re-read before each append).
- Skip generated/vendored files (\`*.generated.*\`, \`dist/\`, \`build/\`, \`vendor/\`, \`node_modules/\`).`;

const STEP4_PROMPT = `You are at step 4 — dependency CVE scan (whole-project). Goal: scan each manifest for known-vulnerable dependencies, append findings, populate section "4. Dependency CVEs" of \`.huu/audits/security.md\`.

=== STEP 1 — Detect manifests ===
From step 1, you already know which manifests exist. For each, pick the most authoritative scanner.

**Node (package.json + lockfile)**
- \`npm audit --json > ./.huu/audits/.tmp/security/npm-audit.json\` (Node ships this; no install required).
- If that fails (no lockfile), try \`npx --yes audit-ci --report-type=full\`.

**Python**
- \`pip-audit --strict --format json > ./.huu/audits/.tmp/security/pip-audit.json\`.
- If pip-audit unavailable: \`safety check --json > ./.huu/audits/.tmp/security/safety.json\`.

**Rust**
- \`cargo audit --json > ./.huu/audits/.tmp/security/cargo-audit.json\`.

**Go**
- \`govulncheck -json ./... > ./.huu/audits/.tmp/security/govulncheck.json\`.

**Cross-language**
- If \`osv-scanner\` is available, run it against the whole repo as a second pass:
  \`\`\`bash
  osv-scanner --format json --output ./.huu/audits/.tmp/security/osv.json -r .
  \`\`\`

=== STEP 2 — Parse outputs ===
For each scanner, extract:
- Package name.
- Installed version.
- Fixed version (if any).
- CVE / GHSA / OSV ID.
- Severity (CVSS / scanner classification).
- A 1-line summary of the vulnerability.

=== STEP 3 — Append findings ===
For each vulnerability:
\`\`\`json
{ "summary": "<package>@<version> — <CVE-ID> (<severity>): <one-liner>", "knowledge": "<full advisory text or scanner's own description, plus 'fixed in <version>' if applicable>", "path": "<manifest path>", "category": "cve", "cwe_id": "<CWE-ID if reported>", "severity": "info|warn|critical", "cheatsheet": "https://cheatsheetseries.owasp.org/cheatsheets/Vulnerable_Dependency_Management_Cheat_Sheet.html" }
\`\`\`

Severity mapping:
- critical CVSS >= 9.0 → critical.
- 7.0–8.9 → warn.
- < 7.0 → info.

=== STEP 4 — Update section "4. Dependency CVEs" ===
Replace placeholder with:

\`\`\`
Total advisories: <N>
Critical: <X>
High: <Y>
Medium / Low: <Z>

Top critical findings:
| Package | Version | CVE | Severity | Fixed in |
|---|---|---|---|---|
| lodash | 4.17.10 | CVE-2019-10744 | critical | 4.17.12 |
| ... | | | | |

(see full list in .huu/audits/security-faq.json — category = "cve")
\`\`\`

=== Cleanup ===
- Delete the \`.huu-*-audit.json\` / \`.huu-osv.json\` / \`.huu-safety.json\` working files after parsing.

=== HARD RULES ===
- DO NOT modify any manifest or lockfile (no auto-upgrade).
- DO NOT call \`npm install\` or any package manager beyond the audit commands.
- If a scanner is unavailable for a stack, write an info-severity FAQ entry and continue.`;

const STEP5_PROMPT = `You are the final agent — step 5. Goal: consolidate all findings in \`.huu/audits/security-faq.json\` into a remediation roadmap, populate sections "5. Summary by severity" and "6. Remediation roadmap" of \`.huu/audits/security.md\`. Add a security badge to README.md.

=== STEP 1 — Read inputs ===
- \`./.huu/audits/security.md\` (sections 1–4 populated).
- \`./.huu/audits/security-faq.json\` (all findings).

=== STEP 2 — Count by severity and category ===
Aggregate:
- Total findings.
- Counts by severity: critical / warn / info.
- Counts by OWASP category (A01..A10).
- Counts by category type: secret / owasp / cve / misc.

=== STEP 3 — Write section "5. Summary by severity" ===

\`\`\`
| Severity | Secrets | OWASP | CVEs | Total |
|---|---|---|---|---|
| critical | 2 | 4 | 1 | 7 |
| warn | 3 | 18 | 6 | 27 |
| info | 0 | 5 | 12 | 17 |
| TOTAL | 5 | 27 | 19 | 51 |

OWASP Top 10 breakdown:
- A01 Broken Access Control: 0
- A02 Cryptographic Failures: 3 (1 critical)
- A03 Injection: 4 (2 critical)
- A04 Insecure Design: 1
- A05 Security Misconfiguration: 8 (1 critical)
- A06 Vulnerable / Outdated Components: see section 4
- A07 Identification and Authentication Failures: 2
- A08 Software and Data Integrity Failures: 0
- A09 Security Logging and Monitoring Failures: 4
- A10 SSRF: 1 (1 critical)
\`\`\`

=== STEP 4 — Write section "6. Remediation roadmap" ===
Order findings into a prioritized roadmap. For each item, link to the OWASP Cheat Sheet that explains the fix.

### Tier 1 — Fix immediately (critical severity)
1. Rotate the AWS access key in src/config.ts:42 and remove from git history (BFG / git filter-repo). https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
2. Parameterize SQL in src/db/users.ts:88 (currently string concat). https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
3. Upgrade lodash to 4.17.21+ (CVE-2019-10744).
...

### Tier 2 — Fix within sprint (warn)
- Replace md5 with sha256 in src/auth/legacy-tokens.ts.
- Enable HttpOnly + SameSite=Strict on the session cookie.
- ...

### Tier 3 — Hygiene (info)
- Pin transitive dependencies.
- Add a SECURITY.md.
- Set up Dependabot / OSV-Scanner in CI.

=== HARD RULES ===
- DO NOT modify any production file. The only output is \`.huu/audits/security.md\`.
- DO NOT add a README badge. If the user wants a security grade in their README, they can copy the grade from the report manually.
- DO NOT rotate any secrets — that requires service-side action.
- DO NOT auto-upgrade dependencies — that needs human review and testing.`;

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    maxRetries: 1,
    maxNodeExecutions: 50,
    steps: [
      {
        type: 'work',
        name: '1. Detect stack, install scanners, scaffold report',
        prompt: STEP1_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '2. Secrets sweep',
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '3. OWASP Top 10 per-file scan: $file',
        prompt: STEP3_PROMPT,
        files: [],
        scope: 'per-file',
      },
      {
        type: 'work',
        name: '4. Dependency CVE scan',
        prompt: STEP4_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '5. Remediation roadmap',
        prompt: STEP5_PROMPT,
        files: [],
        scope: 'project',
      },
    ],
  } as Pipeline;
}

export function getDefaultPipelineFileContent(): string {
  return (
    JSON.stringify(
      {
        _format: 'huu-pipeline-v2',
        exportedAt: new Date().toISOString(),
        pipeline: getDefaultPipeline(),
      },
      null,
      2,
    ) + '\n'
  );
}
