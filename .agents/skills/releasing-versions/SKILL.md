---
name: releasing-versions
description: Step-by-step manual release for huu (no CI) — version + CHANGELOG, full local validation including Docker smokes, tag + push, optional multi-arch GHCR publish with buildx, and post-publish smoke against the published image. Use when cutting vX.Y.Z, publishing the Docker image, or asked about the release process.
metadata:
  version: 0.1.0
  type: task
---

# Releasing Versions

## When to use

Cutting a release, publishing to GHCR, or auditing whether a release was done right.

## Injected knowledge

- Releases are fully manual — no CI exists. Every step below is the contributor's responsibility; skipping the smokes ships untested images.
- Semver with 0.x convention: breaking changes ride MINOR bumps.
- GHCR publish is optional; without it users build locally (`docker build -t huu:local .`, the README default path).
- Prereq for publish: `docker login ghcr.io` with a PAT carrying `write:packages`.

## Procedure

1. Bump `package.json` `version`; move CHANGELOG entries from `[Unreleased]` into `[X.Y.Z] - YYYY-MM-DD` (Keep a Changelog 1.1.0). `npm run release-notes` lists commits since the current version as raw material.
2. Validate locally — all must pass:
   ```bash
   npm run typecheck
   npm test
   docker build -t huu:local .
   ./scripts/smoke-image.sh
   ./scripts/smoke-pipeline.sh
   ```
3. Tag + push:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
4. Optional — publish multi-arch to GHCR:
   ```bash
   docker buildx create --use --name huu-builder 2>/dev/null || docker buildx use huu-builder
   docker buildx build \
     --platform linux/amd64,linux/arm64 \
     --tag ghcr.io/frederico-kluser/huu:X.Y.Z \
     --tag ghcr.io/frederico-kluser/huu:X.Y \
     --tag ghcr.io/frederico-kluser/huu:X \
     --tag ghcr.io/frederico-kluser/huu:latest \
     --push .
   ```
5. Smoke the PUBLISHED image (not the local one):
   ```bash
   ./scripts/smoke-image.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ./scripts/smoke-pipeline.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ```

## References

- AGENTS.md "Release procedure" (canonical), `CHANGELOG.md`, `scripts/smoke-*.sh`
- Related skills: committing-and-validating, running-in-docker

> Facts verified against AGENTS.md on 2026-06-12.

## <evolution>

After the task completes:

1. Only persist learnings if the release shipped and post-publish smokes passed.
2. Keep only non-obvious, durable learnings: publish failures, buildx quirks, versioning decisions made by the user. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain (release flow → here; docker/build details → running-in-docker). Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. If LEARNINGS.md shows a stable repeated pattern, distill it into this SKILL.md body and bump `metadata.version`.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
