// Security-audit pipeline. OWASP Top 10:2025 + CWE Top 25 (2025) +
// dependency CVE scan + secrets sweep + supply-chain/CI posture. REPORT-ONLY.
// A judge CheckStep validates the report before the run finishes.
//
// References:
// - OWASP Top 10 (2025): https://owasp.org/Top10/2025/
// - OWASP Cheat Sheet Series (per-category prevention): https://cheatsheetseries.owasp.org/
// - CWE Top 25 2025: https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html
// - SLSA v1.2 (supply chain levels): https://slsa.dev/spec/v1.2/
// - OpenSSF Scorecard checks: https://github.com/ossf/scorecard/blob/main/docs/checks.md
// - GitHub Actions pwn requests: https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/
// - Secrets scanning tools: gitleaks (v8.19+ `git`/`dir` subcommands), trufflehog, detect-secrets.

import type { Pipeline } from '../types.js';
import {
  knowledgeProtocol,
  persistenceCheck,
  reportJudgeCondition,
  targetsRecon,
  KNOWLEDGE_OPTIONAL_FIELDS_NOTE,
  KNOWLEDGE_ORDERING_NOTE,
} from './knowledge-protocol.js';

const OWASP_TARGETS_PATH = '.huu/audits/security-targets.json';
const OWASP_TARGETS_MAX_FILES = 30;

export const DEFAULT_PIPELINE_FILENAME = 'huu-security-audit.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Security Audit';

const FAQ_PATH = './.huu/audits/security-faq.json';
const FAQ_SCHEMA_LINE =
  '{ "summary": "<=256>", "knowledge": "<=5000>", "path": "<file or \'global\'>", "category": "secret|owasp-a01..a10|cve|supply-chain|misc", "cwe_id": "CWE-XXX or null", "severity": "info|warn|critical", "cheatsheet": "<URL>" }';

const STEP1_PROMPT = `You are huu's security-audit bootstrap agent. Goal: detect the stack, make ephemeral security scanners available, write \`.huu/audits/security.md\` scaffold, initialize \`.huu/audits/security-faq.json\`.

=== STEP 0 — REPORT-ONLY HARD RULE ===
You may NOT modify any file in the repo OTHER than the audit artifacts under \`.huu/audits/\` (and \`.huu/audits/.tmp/\` for working files) plus the single \`.gitignore\` adjustment described below. If a tool requires installation, use \`npx --yes <tool>\` (Node), \`pipx run <tool>\` (Python), or vendored binaries under \`$HOME/.huu/bin/\`. NEVER touch package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod, lockfiles, or any production source. Create the output directory with \`mkdir -p .huu/audits/.tmp/security\` before writing.

${persistenceCheck('audits')}

=== STEP 1 — Detect the stack and manifest files ===
Identify presence of:
- \`package.json\` (npm/yarn/pnpm) + lockfiles.
- \`requirements*.txt\`, \`pyproject.toml\`, \`Pipfile.lock\`.
- \`Cargo.toml\` + \`Cargo.lock\`.
- \`go.mod\` + \`go.sum\`.
- \`pom.xml\`, \`build.gradle\` (Maven/Gradle).
- \`Gemfile.lock\`.
- \`composer.lock\`.
- CI workflows: \`.github/workflows/*.yml\`, \`.gitlab-ci.yml\`, \`Jenkinsfile\`, \`azure-pipelines.yml\` (input for the supply-chain step).

Identify the source languages by file extension count (similar to the Quality Audit pipeline's step 1).

=== STEP 2 — Best-effort tool install ===
Each install attempt is independent; STOP at first success per tool family; NEVER \`sudo\`. If all install attempts for a tool family fail, append an info-severity FAQ finding and continue with grep heuristics.

**Secret scanning**
- \`gitleaks version\` — already installed? (v8.19+ uses the \`git\`/\`dir\` subcommands; the old \`detect\` still works but is deprecated.)
- \`brew install gitleaks\` (mac/linuxbrew).
- \`curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/.github/install.sh | sh -s -- -b /tmp/huu-bin\` (vendored install).
- Else \`pipx install detect-secrets\`, or \`trufflehog\` if already present (do NOT use its live credential verification — see hard rules).

**SAST**
- \`pipx install semgrep\` (or \`brew install semgrep\`).
- If install succeeds, the per-file step uses \`semgrep scan --config p/owasp-top-ten\` (registry ruleset that maps findings to Top 10 ids; \`p/cwe-top-25\` and \`p/security-audit\` are good companions).

**Dependency CVE**
- Node: \`npm audit\` (built-in; just need lockfile).
- Python: \`pipx install pip-audit\`.
- Rust: \`cargo install --locked cargo-audit\`.
- Go: \`go install golang.org/x/vuln/cmd/govulncheck@latest\` (into \`$HOME/.huu/bin\` via GOBIN).
- Cross-language: osv-scanner (Google OSV; v2 syntax is \`osv-scanner scan source -r .\`).

=== STEP 3 — Write .huu/audits/security.md scaffold ===
Path: \`./.huu/audits/security.md\`.

# .huu/audits/security.md — Security audit

> Report-only audit aligned to OWASP Top 10:2025 + CWE Top 25 (2025) + dependency CVEs + secret-leak scan + supply-chain posture (SLSA v1.2 / OpenSSF Scorecard informed). No code was modified.
> References: https://owasp.org/Top10/2025/ ; https://cheatsheetseries.owasp.org/ ; https://cwe.mitre.org/top25/archive/2025/2025_cwe_top25.html ; https://slsa.dev/spec/v1.2/

## 1. Scope
- Stack detected: <languages>
- Manifests found: <list>
- CI workflows found: <list>
- Tools active: <list>
- Tools unavailable: <list with reasons>

## 2. Secrets sweep
(filled in by the secrets-sweep step)

## 3. OWASP Top 10:2025 findings
(filled in by the OWASP scan)

## 4. Dependency CVEs
(filled in by the dependency-CVE step)

## 5. Supply chain & CI posture
(filled in by the supply-chain step)

## 6. Summary by severity
(filled in by the consolidation step)

## 7. Remediation roadmap
(filled in by the consolidation step)

## 8. Validation
(filled in by the final step after the judge approves)

=== STEP 4 — Initialize .huu/audits/security-faq.json ===
Schema:
\`\`\`json
{ "summary": "<=256>", "knowledge": "<=5000>", "path": "<file or 'global'>", "category": "secret|owasp-a01|owasp-a02|owasp-a03|owasp-a04|owasp-a05|owasp-a06|owasp-a07|owasp-a08|owasp-a09|owasp-a10|cve|supply-chain|misc", "cwe_id": "CWE-XXX or null", "severity": "info|warn|critical", "cheatsheet": "<URL>" }
\`\`\`
Category ids follow OWASP Top 10:2025 (A03 = Software Supply Chain Failures, A10 = Mishandling of Exceptional Conditions; SSRF lives under A01 since 2025).
${KNOWLEDGE_OPTIONAL_FIELDS_NOTE}

=== HARD RULES ===
- DO NOT modify production source code.
- DO NOT exfiltrate any secrets you find — redact them in findings (first 4 + last 4 chars only).
- DO NOT call external services beyond the listed scanners (e.g. don't curl arbitrary URLs from secrets, and never use trufflehog's live credential verification).`;

const STEP_RECON_PROMPT = `${targetsRecon({
  role: "huu's OWASP scan-target selector",
  purpose: 'scanning for OWASP Top 10:2025 / CWE Top 25 weaknesses in',
  prefer: [
    'files that handle UNTRUSTED INPUT — HTTP route handlers, controllers, GraphQL/RPC resolvers, form/body/query parsers, webhook receivers',
    'security-sensitive sinks — DB query builders, command/shell execution, file-path joins, template rendering, deserialization (pickle/yaml/ObjectInputStream)',
    'auth & crypto code — login/session/token logic, password handling, signing/encryption, access-control middleware',
    'configuration & integration code — CORS/headers setup, env/secret loading, outbound fetch/SSRF surfaces',
  ],
  hintGuide:
    'name the concrete OWASP categories / sinks to inspect here (e.g. "raw SQL in getUser()", "fetch(req.body.url) — SSRF", "verify=False on the TLS client")',
  maxFiles: OWASP_TARGETS_MAX_FILES,
})}

=== BEFORE YOU START ===
Read \`./.huu/audits/security.md\` section 1 (the scaffold step recorded which scanners are available) — when Semgrep is present, lean toward the files its rulesets would flag. This step writes ONLY the target list; the per-file OWASP scan that follows does the actual finding.`;

const STEP2_PROMPT = `You are at the secrets sweep step (whole-project). Goal: find committed secrets in current files AND in git history, redact them, append findings, populate section "2. Secrets sweep" of \`.huu/audits/security.md\`. NO code changes.

${knowledgeProtocol(FAQ_PATH, FAQ_SCHEMA_LINE)}
In particular: step 1 recorded which scanners are actually available (and which install attempts failed) — read those findings instead of re-probing every tool.

=== STEP 1 — Run gitleaks (preferred) ===
gitleaks v8.19+ splits the scan modes into subcommands. Working tree:
\`\`\`bash
gitleaks dir . --redact --report-format json --report-path ./.huu/audits/.tmp/security/gitleaks.json --no-banner
\`\`\`

Full git history (all refs):
\`\`\`bash
gitleaks git . --redact --report-format json --report-path ./.huu/audits/.tmp/security/gitleaks-history.json --no-banner --log-opts="--all"
\`\`\`

(On an older gitleaks without the subcommands, fall back to \`gitleaks detect --redact ...\` and \`--log-opts="--all"\`.) Parse the JSON reports.

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

const STEP3_PROMPT = `You are the OWASP Top 10:2025 sweep for ONE file: \`$file\`. Goal: scan \`$file\` for OWASP Top 10:2025 patterns, append findings to \`.huu/audits/security-faq.json\`. NO code changes. You are one of many agents running in parallel; your whole job is this single file.

The recon step chose this file deliberately and left you a lead — start there: $hint

=== STEP 0 — SKIP RULE ===
SKIP IMMEDIATELY (no findings, no FAQ append) if \`$file\` matches: \`node_modules/\`, \`dist/\`, \`build/\`, \`out/\`, \`coverage/\`, \`.git/\`, \`vendor/\`, \`target/\`, \`__pycache__/\`, \`*.generated.*\`, \`*.min.js\`, \`*.min.css\`, \`*.d.ts\`, \`*.lock\`, \`*.snap\`.

=== OWASP Top 10:2025 checklist ===
(2025 reshuffle: Security Misconfiguration is now A02; Software Supply Chain Failures (A03) and Mishandling of Exceptional Conditions (A10) are NEW; SSRF merged into A01. Source: https://owasp.org/Top10/2025/)
For each category, the patterns to flag in \`$file\`. Where Semgrep is available (check .huu/audits/security.md section 1), prefer running \`semgrep scan --config p/owasp-top-ten --json "$file"\` and merge with the heuristic findings below.

**A01:2025 — Broken Access Control** (CWE-284, CWE-285, CWE-639, CWE-862, CWE-918)
- HTTP handlers that read a user-supplied ID and return data without an authz check (\`req.params.id\`, \`request.GET['id']\` going straight into DB without a "current user owns this" check).
- IDOR signals: \`/api/users/:id\` patterns where the handler doesn't verify ownership (CWE-639 is in the 2025 CWE Top 25).
- Hardcoded role bypass: \`if (user.email === "admin@*")\`.
- SSRF (merged here in 2025): user-controlled URL into a server-side fetch — \`fetch(req.body.url)\`, \`requests.get(request.GET['url'])\`, \`HttpClient.GetAsync(userUrl)\` (CWE-918).
- Cheat sheets: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html ; https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

**A02:2025 — Security Misconfiguration** (CWE-16, CWE-2)
- \`DEBUG = True\` (Django/Flask) in production config files.
- Open CORS: \`Access-Control-Allow-Origin: *\` combined with \`Access-Control-Allow-Credentials: true\`.
- Default credentials: \`password = "password"\`, \`admin/admin\`.
- Detailed error pages leaked: \`stack=err.stack\` returned to response.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html

**A03:2025 — Software Supply Chain Failures** (CWE-1104, CWE-829)
- Per-file signals only (step 5 audits the CI/workflow posture project-wide): manual fetches from unpinned CDNs (\`<script src="https://cdn.../latest/...">\`), \`curl ... | bash\` install patterns, imports of abandoned/typosquat-looking packages.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Software_Supply_Chain_Security_Cheat_Sheet.html

**A04:2025 — Cryptographic Failures** (CWE-327, CWE-329, CWE-330)
- Weak hashes: \`md5(\`, \`sha1(\`, \`crypto.createHash("md5")\`, \`hashlib.md5\`.
- Weak ciphers: \`DES\`, \`3DES\`, \`RC4\`, \`AES.*ECB\`.
- Hardcoded keys / IVs / salts (string literals near \`createCipheriv\`, \`Cipher(key=\`).
- TLS misconfiguration: \`rejectUnauthorized: false\`, \`verify=False\`, \`InsecureSkipVerify: true\`, \`TLSv1\`/\`TLSv1.1\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html

**A05:2025 — Injection** (CWE-79, CWE-89, CWE-78, CWE-94 — the top 4 of the CWE Top 25 2025 all live here or in A01)
- SQL: string concatenation / template literals with raw values into queries (\`query("SELECT * FROM users WHERE id=" + id)\`, f-string SQL).
- OS Command: \`exec\`, \`spawn\`, \`shell=True\`, \`os.system(...)\` with user input.
- XSS: \`innerHTML =\`, \`dangerouslySetInnerHTML\`, \`document.write(\`, \`v-html\`, Django \`mark_safe\` on user input.
- Code injection: \`eval(\`, \`Function(\`, \`new Function(\`, Python \`exec(\`, Ruby \`eval(\`.
- Path traversal (CWE-22, #6 in CWE Top 25 2025): user input joined into fs paths without normalization (\`path.join(base, req.params.name)\`, \`open(f"uploads/{name}")\`).
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Injection_Prevention_Cheat_Sheet.html

**A06:2025 — Insecure Design** (CWE-209, CWE-256, CWE-501)
- Hard to spot statically; flag suspicious comments like \`TODO: add auth\`, \`FIXME: trust user input\`, \`HACK: skip validation\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html

**A07:2025 — Authentication Failures** (CWE-287, CWE-307)
- Plain text password storage: \`user.password = body.password\` without a hash function.
- Weak password validation: regex allowing short or trivial passwords.
- Session cookies without \`httpOnly\` / \`secure\` / \`SameSite\`.
- Missing rate limit middleware on \`/login\` / \`/auth\` routes (CWE-307).
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

**A08:2025 — Software or Data Integrity Failures** (CWE-502)
- Unsafe deserialization: \`pickle.load\`, \`yaml.load\` (without \`SafeLoader\`), \`Marshal.load\`, \`ObjectInputStream.readObject\`, \`JSON.parse\` of attacker-controlled input feeding \`new Function\`.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html

**A09:2025 — Security Logging and Alerting Failures** (CWE-778)
- Logging that includes PII or secrets: \`logger.info("user: \\\${user}")\` where \`user\` includes password / token field.
- Missing audit trail on sensitive ops: \`deleteUser\`, \`grantAdmin\`, etc. without a log line.
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

**A10:2025 — Mishandling of Exceptional Conditions** (NEW in 2025; CWE-755, CWE-754, CWE-390)
- Swallowed exceptions: empty \`catch {}\` / \`except: pass\` around security-relevant operations (auth, payment, permission checks).
- Fail-open patterns: \`catch (e) { return true; }\` or defaulting to "allow" when a check throws.
- Unchecked return values of security APIs (e.g. ignoring \`verify()\` results).
- Cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Error_Handling_Cheat_Sheet.html

=== STEP 1 — Read inputs ===
- \`./.huu/audits/security.md\` (note which tools are available).
- \`./.huu/audits/security-faq.json\`.
- \`$file\`.

=== STEP 2 — Run Semgrep on \`$file\` if available ===
\`\`\`bash
semgrep scan --config p/owasp-top-ten --json "$file" > ./.huu/audits/.tmp/security/semgrep.json
\`\`\`
Parse the JSON and merge findings. (Semgrep's ruleset still tags some findings with 2021 ids; re-map them — e.g. injection → owasp-a05, misconfiguration → owasp-a02, SSRF → owasp-a01.)

=== STEP 3 — Run the OWASP heuristics above ===
For EACH match across all 10 categories:
\`\`\`json
{ "summary": "$file:<line>: A05 Injection — SQL string concat", "knowledge": "<the offending code, why it's flagged, link to OWASP Cheat Sheet>", "path": "$file", "category": "owasp-a05", "cwe_id": "CWE-89", "severity": "warn|critical", "cheatsheet": "https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html" }
\`\`\`

Severity rules:
- critical: confirmed injection vector or hardcoded secret-like pattern OR plain-text password persistence OR fail-open exception handling on an auth path.
- warn: pattern is suspect but needs human confirmation (e.g. \`innerHTML =\` might be safe if input is already escaped).
- info: low-confidence patterns (\`TODO: add auth\` style).

=== Cleanup ===
- Delete \`./.huu/audits/.tmp/security/semgrep.json\` after parsing.

=== HARD RULES ===
- DO NOT modify \`$file\` or any other file.
- Append-only to FAQ (re-read before each append).
- Skip generated/vendored files (\`*.generated.*\`, \`dist/\`, \`build/\`, \`vendor/\`, \`node_modules/\`).`;

const STEP4_PROMPT = `You are the dependency CVE scan step (whole-project). Goal: scan each manifest for known-vulnerable dependencies, append findings, populate section "4. Dependency CVEs" of \`.huu/audits/security.md\`.

${knowledgeProtocol(FAQ_PATH, FAQ_SCHEMA_LINE)}
In particular: if the FAQ already contains owasp-a03 findings (unpinned CDN fetches, curl|bash installs — the OWASP scan may be running concurrently), cross-reference what's present — a CVE in a package already flagged at a call site deserves "priority": 1.

=== STEP 1 — Detect manifests ===
From step 1, you already know which manifests exist. For each, pick the most authoritative scanner.

**Node (package.json + lockfile)**
- \`npm audit --json > ./.huu/audits/.tmp/security/npm-audit.json\` (Node ships this; no install required).
- If that fails (no lockfile), try \`npx --yes audit-ci --report-type=full\`.

**Python**
- \`pip-audit --strict --format json > ./.huu/audits/.tmp/security/pip-audit.json\` (add \`-r requirements.txt\` when there's no installed env).
- If pip-audit unavailable: \`safety check --json > ./.huu/audits/.tmp/security/safety.json\`.

**Rust**
- \`cargo audit --json > ./.huu/audits/.tmp/security/cargo-audit.json\` (reads Cargo.lock against the RustSec DB).

**Go**
- \`govulncheck -format json ./... > ./.huu/audits/.tmp/security/govulncheck.json\`.

**Cross-language**
- If \`osv-scanner\` is available (v2), run it against the whole repo as a second pass:
  \`\`\`bash
  osv-scanner scan source -r . --format json --output ./.huu/audits/.tmp/security/osv.json
  \`\`\`
  (v1 fallback: \`osv-scanner --format json --output <path> -r .\`.)

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
- Delete the working JSON files under \`./.huu/audits/.tmp/security/\` after parsing.

=== HARD RULES ===
- DO NOT modify any manifest or lockfile (no auto-upgrade).
- DO NOT call \`npm install\` or any package manager beyond the audit commands.
- If a scanner is unavailable for a stack, write an info-severity FAQ entry and continue.`;

const STEP5_PROMPT = `You are the supply chain & CI posture step (whole-project). Goal: audit the repo's software-supply-chain hygiene (OWASP A03:2025), informed by SLSA v1.2 and the OpenSSF Scorecard checks. Append findings, populate section "5. Supply chain & CI posture" of \`.huu/audits/security.md\`. NO code changes.

${knowledgeProtocol(FAQ_PATH, FAQ_SCHEMA_LINE)}

=== Checklist (each item → one finding when it fails) ===
References: https://slsa.dev/spec/v1.2/ ; https://github.com/ossf/scorecard/blob/main/docs/checks.md ; https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/

**Dependency pinning (Scorecard: Pinned-Dependencies)**
- Every manifest has its lockfile COMMITTED (package-lock.json/pnpm-lock.yaml/yarn.lock, Cargo.lock, go.sum, poetry.lock/uv.lock, Gemfile.lock, composer.lock). Missing lockfile → warn.
- Dockerfiles: base images pinned by digest (\`@sha256:\`) or at least a full version tag — \`FROM node:latest\` → warn.
- Shell/build scripts: \`curl ... | bash\` / \`wget ... | sh\` installs → warn (critical if the URL is http:// or unversioned).

**CI workflow poisoning ("pwn requests") — GitHub Actions**
- \`pull_request_target\` or \`workflow_run\` triggers combined with a checkout of the PR head (\`ref: github.event.pull_request.head.sha\` / \`.ref\`) → critical (privileged context running attacker code).
- Untrusted interpolation: \`\${{ github.event.pull_request.title }}\`, \`.body\`, \`.head_ref\`, issue titles, comment bodies expanded inside \`run:\` blocks → critical (script injection).
- Actions referenced by mutable tag (\`uses: some/action@v3\`) instead of a full commit SHA → info (warn for actions with secrets access).
- Workflows without a top-level \`permissions:\` block, or with \`permissions: write-all\` → warn (least-privilege GITHUB_TOKEN).

**Repository posture (Scorecard-style)**
- Committed binary artifacts (\`*.exe\`, \`*.jar\`, \`*.so\`, \`*.dylib\`, \`*.wasm\` outside vendored dirs) → warn (Binary-Artifacts).
- \`SECURITY.md\` missing → info (Security-Policy).
- No SBOM and no release signing evidence → info (note only; SLSA Build L1 starts at provenance existing).

For each failed item:
\`\`\`json
{ "summary": "CI: pull_request_target + PR-head checkout in .github/workflows/ci.yml", "knowledge": "<the offending lines, why this is exploitable, link>", "path": ".github/workflows/ci.yml", "category": "supply-chain", "cwe_id": "CWE-829", "severity": "critical", "cheatsheet": "https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html" }
\`\`\`

=== Update section "5. Supply chain & CI posture" ===
\`\`\`
Lockfiles: <present/missing per manifest>
Image pinning: <ok | N unpinned FROMs>
GitHub Actions: <N> workflows · SHA-pinned actions: <X>/<Y> · permissions blocks: <present/missing>
Pwn-request exposure: <none found | N findings (critical)>
Posture: SECURITY.md <yes/no> · binary artifacts <none | list>
SLSA orientation: build provenance <none observed | partial> (Build L0–L3, Source L1–L3 — see https://slsa.dev/spec/v1.2/)
\`\`\`

=== HARD RULES ===
- DO NOT modify workflows, Dockerfiles, or manifests — detection only.
- DO NOT fetch remote actions or images to inspect them; static repo content only.`;

const STEP6_PROMPT = `You are the consolidation step. Goal: consolidate all findings in \`.huu/audits/security-faq.json\` into a remediation roadmap, populate sections "6. Summary by severity" and "7. Remediation roadmap" of \`.huu/audits/security.md\`. Report-only — README is never touched.

=== STEP 1 — Read inputs ===
- \`./.huu/audits/security.md\` (sections 1–5 populated).
- \`./.huu/audits/security-faq.json\` (all findings).

=== STEP 2 — Count by severity and category ===
Aggregate:
- Total findings.
- Counts by severity: critical / warn / info.
- Counts by OWASP category (A01..A10, 2025 ids).
- Counts by category type: secret / owasp / cve / supply-chain / misc.
The table counts MUST match the FAQ entries exactly — the validation judge recounts them.

=== STEP 3 — Write section "6. Summary by severity" ===

\`\`\`
| Severity | Secrets | OWASP | CVEs | Supply chain | Total |
|---|---|---|---|---|---|
| critical | 2 | 4 | 1 | 1 | 8 |
| warn | 3 | 18 | 6 | 2 | 29 |
| info | 0 | 5 | 12 | 3 | 20 |
| TOTAL | 5 | 27 | 19 | 6 | 57 |

OWASP Top 10:2025 breakdown:
- A01 Broken Access Control (incl. SSRF): 1 (1 critical)
- A02 Security Misconfiguration: 8 (1 critical)
- A03 Software Supply Chain Failures: 6
- A04 Cryptographic Failures: 3 (1 critical)
- A05 Injection: 4 (2 critical)
- A06 Insecure Design: 1
- A07 Authentication Failures: 2
- A08 Software or Data Integrity Failures: 0
- A09 Security Logging and Alerting Failures: 4
- A10 Mishandling of Exceptional Conditions: 2
\`\`\`

=== STEP 4 — Write section "7. Remediation roadmap" ===
Order findings into a prioritized roadmap. For each item, link to the OWASP Cheat Sheet that explains the fix.
${KNOWLEDGE_ORDERING_NOTE}

### Tier 1 — Fix immediately (critical severity)
1. Rotate the AWS access key in src/config.ts:42 and remove from git history (BFG / git filter-repo). https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
2. Parameterize SQL in src/db/users.ts:88 (currently string concat). https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
3. Remove the PR-head checkout from the pull_request_target workflow. https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html
...

### Tier 2 — Fix within sprint (warn)
- Replace md5 with sha256 in src/auth/legacy-tokens.ts.
- Enable HttpOnly + SameSite=Strict on the session cookie.
- Pin GitHub Actions to commit SHAs.
- ...

### Tier 3 — Hygiene (info)
- Pin transitive dependencies.
- Add a SECURITY.md.
- Set up Dependabot / OSV-Scanner in CI; consider SLSA provenance for releases.

=== HARD RULES ===
- DO NOT modify any production file. The only output is \`.huu/audits/security.md\`.
- DO NOT add a README badge. If the user wants a security grade in their README, they can copy the grade from the report manually.
- DO NOT rotate any secrets — that requires service-side action.
- DO NOT auto-upgrade dependencies — that needs human review and testing.`;

const STEP8_PROMPT = `You are the final agent (post-validation). The judge approved the report. Goal: stamp section "8. Validation" of \`.huu/audits/security.md\` and leave the working tree clean.

=== STEP 1 — Stamp the validation section ===
Replace the "## 8. Validation" placeholder with:
\`\`\`
Validated: <UTC timestamp> · findings: <total> (critical <X> / warn <Y> / info <Z>) · sections 1–7 complete · secrets redacted.
Validation gate: judge CheckStep ("approved" required to reach this step; "rework" loops back to consolidation, max 2 judge runs).
\`\`\`
Numbers MUST come from re-reading \`.huu/audits/security-faq.json\` — do not invent them. Be idempotent: if the section is already stamped (a rework loop ran twice), overwrite it with fresh numbers.

=== STEP 2 — Exit hygiene ===
- Delete any leftovers under \`./.huu/audits/.tmp/security/\` (keep the directory).
- Confirm \`git status --porcelain\` shows changes only under \`.huu/\` (plus at most the permitted \`.gitignore\` adjustment).

=== HARD RULES ===
- DO NOT modify the findings or the roadmap — stamp only.
- DO NOT touch production files.`;

// Step names as constants so the dependsOn wave wiring can't drift from the
// `name` fields (a typo would fail validateTopology — but cheaper to prevent).
const N_SCAFFOLD = '1. Detect stack, install scanners, scaffold report';
const N_RECON = '2. Select OWASP scan targets';
const N_SECRETS = '3. Secrets sweep';
const N_OWASP = '4. OWASP Top 10:2025 scan for $file';
const N_CVE = '5. Dependency CVE scan';
const N_SUPPLY = '6. Supply chain & CI posture';
const N_CONSOLIDATE = '7. Remediation roadmap';
const N_JUDGE = '8. Validate report';
const N_FINALIZE = '9. Finalize report';

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    description:
      'Secrets sweep, OWASP Top 10:2025 scan, dependency CVE check and supply-chain / CI posture, run as parallel waves and consolidated into a remediation roadmap. Report-only.',
    maxRetries: 1,
    maxNodeExecutions: 50,
    // dependsOn switches the run into DETERMINISTIC WAVES. After the scaffold,
    // the four INDEPENDENT scan dimensions (recon, secrets, CVE, supply-chain)
    // fan out in one parallel wave; the OWASP per-file scan waits only on its
    // target list; consolidation joins all four. Merges stay deterministic
    // (array order). The judge loops back to consolidation on "rework".
    steps: [
      {
        type: 'work',
        name: N_SCAFFOLD,
        prompt: STEP1_PROMPT,
        files: [],
        scope: 'project',
        dependsOn: [],
      },
      {
        type: 'work',
        name: N_RECON,
        prompt: STEP_RECON_PROMPT,
        files: [],
        scope: 'project',
        // huu appends the huu-memory-v1 MEMORY CONTRACT (path + format + cap).
        produces: OWASP_TARGETS_PATH,
        dependsOn: [N_SCAFFOLD],
      },
      {
        type: 'work',
        name: N_SECRETS,
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'project',
        dependsOn: [N_SCAFFOLD],
      },
      {
        type: 'work',
        name: N_OWASP,
        prompt: STEP3_PROMPT,
        files: [],
        // Autonomous file set from the recon step — no per-file picker.
        scope: 'memory',
        filesFrom: OWASP_TARGETS_PATH,
        maxFiles: OWASP_TARGETS_MAX_FILES,
        dependsOn: [N_RECON],
      },
      {
        type: 'work',
        name: N_CVE,
        prompt: STEP4_PROMPT,
        files: [],
        scope: 'project',
        dependsOn: [N_SCAFFOLD],
      },
      {
        type: 'work',
        name: N_SUPPLY,
        prompt: STEP5_PROMPT,
        files: [],
        scope: 'project',
        dependsOn: [N_SCAFFOLD],
      },
      {
        type: 'work',
        name: N_CONSOLIDATE,
        prompt: STEP6_PROMPT,
        files: [],
        scope: 'project',
        // Join: waits on every scan dimension before building the roadmap.
        dependsOn: [N_SECRETS, N_OWASP, N_CVE, N_SUPPLY],
      },
      {
        type: 'check',
        name: N_JUDGE,
        condition: reportJudgeCondition({
          reportPath: '.huu/audits/security.md',
          faqPath: '.huu/audits/security-faq.json',
          requiredSections: [
            '1. Scope',
            '2. Secrets sweep',
            '3. OWASP Top 10:2025 findings',
            '4. Dependency CVEs',
            '5. Supply chain & CI posture',
            '6. Summary by severity',
            '7. Remediation roadmap',
          ],
          extraClauses: [
            'every secret in the report and the FAQ is redacted to first-4 + last-4 characters — grep for plausible full-length keys (AKIA[0-9A-Z]{16}, ghp_..., xox.-...) and fail if any full secret appears.',
          ],
        }),
        maxRuns: 2,
        dependsOn: [N_CONSOLIDATE],
        outcomes: [
          { label: 'approved', nextStepName: N_FINALIZE, default: true },
          { label: 'rework', nextStepName: N_CONSOLIDATE },
        ],
      },
      {
        type: 'work',
        name: N_FINALIZE,
        prompt: STEP8_PROMPT,
        files: [],
        scope: 'project',
        dependsOn: [N_JUDGE],
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
