---
name: releasing-versions
description: Step-by-step manual release for huu (no CI) — version + CHANGELOG, clean-rebuild + validation, then npm publish and multi-arch GHCR push run IN PARALLEL behind ONE up-front credential gate (GitHub PAT + fresh npm OTP), then tag + push. Use when cutting vX.Y.Z, publishing to npm or GHCR, or auditing the release process.
metadata:
  version: 0.2.0
  type: task
---

# Releasing Versions

## When to use

Cutting a release, publishing to GHCR, or auditing whether a release was done right.

## Injected knowledge

- Releases are fully manual — no CI exists. Every step below is the contributor's responsibility.
- Semver at 1.x+: BREAKING changes ride a MAJOR bump (e.g. removing `huu --web` shipped as 2.0.0). The "0.x → breaking-in-minor" rule only governed the 0.x phase; the CHANGELOG header line still saying otherwise is stale.
- TWO publish targets with DIFFERENT credentials — gather BOTH at ONE up-front gate so they run IN PARALLEL instead of serial-with-surprises:
  - **npm** needs a FRESH 2FA OTP (TOTP, ~30s window). Undetectable in advance (`npm whoami` / `npm access get status` / `npm profile get` don't reveal it) — it surfaces only as `npm error code EOTP`. The agent CANNOT generate it: the user runs `npm publish --otp=<code>` (or pastes a fresh code) via the `!` session prefix.
  - **GHCR** needs `docker login ghcr.io --password-stdin` with a NON-expired classic PAT carrying `write:packages`. Diagnose a `denied` push fast: `curl -sS -D - -o /dev/null -H "Authorization: token <PAT>" https://api.github.com` → `401` = invalid/expired token, NOT a scope problem.
- `npm publish` never touches git → do BOTH publishes BEFORE the git tag/push, so a credential failure leaves a clean tree to retry.
- After any source REMOVAL: `rm -rf dist && npm run build` before publishing — `tsc` doesn't prune orphaned outputs and `prepack` strips only `*.test.*`/`*.spec.*`. Confirm with `npm publish --dry-run`.
- GHCR multi-arch prereqs (see running-in-docker): a host-network buildkit builder (`docker buildx create --driver-opt network=host`) + arm64 QEMU (`tonistiigi/binfmt --install arm64`); `--provenance=false` keeps the manifest to amd64+arm64.
- `scripts/deploy.ts` (`npm run deploy`) is the canonical flow but is INTERACTIVE and serial — for an agent-driven release follow the parallel procedure below.

## Procedure

1. **Prep (no credentials yet).**
   - Bump `package.json` `version`; move CHANGELOG `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` and update the compare links (`[Unreleased]: …/compare/vX.Y.Z...HEAD` + a new `[X.Y.Z]: …/compare/vPREV...vX.Y.Z`). `npm run release-notes` lists commits since the last tag.
   - `rm -rf dist && npm run typecheck && npm test && npm run build`.
   - `npm publish --dry-run` — confirm the version AND that the tarball matches current source (nothing whose source was deleted; e.g. grep the file list for removed modules).
2. **One up-front credential gate — ask for BOTH together.** In a SINGLE prompt, ask the user for (a) a GitHub PAT with `write:packages` and (b) a FRESH npm OTP. Log into GHCR right away: `echo '<PAT>' | docker login ghcr.io -u frederico-kluser --password-stdin`. The gate sits HERE — after prep, not at the very start — because the OTP is only valid ~30s and you can't publish an unbuilt package.
3. **Fire BOTH deploys in PARALLEL.**
   - Start the GHCR multi-arch build+push in the BACKGROUND (slow — emulated arm64):
     ```bash
     docker buildx build --builder huu-host --allow network.host --provenance=false \
       --platform linux/amd64,linux/arm64 \
       --tag ghcr.io/frederico-kluser/huu:X.Y.Z --tag ghcr.io/frederico-kluser/huu:X.Y \
       --tag ghcr.io/frederico-kluser/huu:X --tag ghcr.io/frederico-kluser/huu:latest \
       --push .
     ```
   - Immediately have the user run npm publish with the fresh OTP (fast; finishes while GHCR builds): `npm publish --otp=<code>` via the `!` session prefix.
   - Wait for the background GHCR build to finish.
4. **Tag + push git** (last — publishes don't touch git, so a failure above never leaves a dangling release commit):
   ```bash
   git add package.json CHANGELOG.md && git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z && git push origin main vX.Y.Z
   ```
5. **Verify both.** `npm view huu-pipe version` = X.Y.Z; `docker buildx imagetools inspect ghcr.io/frederico-kluser/huu:X.Y.Z` shows BOTH `linux/amd64` + `linux/arm64` (tags resolve to one digest). Optional: smoke the PUBLISHED image — `./scripts/smoke-image.sh ghcr.io/frederico-kluser/huu:X.Y.Z` + `./scripts/smoke-pipeline.sh …`.

## References

- AGENTS.md "Release procedure" (canonical), `CHANGELOG.md`, `scripts/smoke-*.sh`
- Related skills: committing-and-validating, running-in-docker

> Facts verified against AGENTS.md on 2026-06-12; parallel npm+GHCR flow + up-front credential gate verified against the v2.0.0 release on 2026-06-25.

## <evolution>

After the task completes:

1. Only persist learnings if the release shipped and post-publish smokes passed.
2. Keep only non-obvious, durable learnings: publish failures, buildx quirks, versioning decisions made by the user. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (release flow → here; docker/build details → running-in-docker). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
