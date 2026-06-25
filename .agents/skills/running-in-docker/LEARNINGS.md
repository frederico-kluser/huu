# Learnings — running-in-docker

Append-only log consumed by meta-skill-evolution and meta-skill-consolidate.
Entry format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>`
States: probation (default) -> promoted (distilled into SKILL.md by meta-skill-consolidate after dual-buffer check) | superseded (kept for history, never deleted).
Learnings are routed here when THIS skill owns the domain of the fact — regardless of which skill ran the task.

<!-- entries below this line -->
- [2026-06-25][source:inference][task:npm-deploy-v2.0.0][probation] Multi-arch GHCR build+push in this env needs a buildkit builder whose CONTAINER is on the host network: `docker buildx create --name huu-host --driver docker-container --driver-opt network=host --bootstrap`. The pre-existing `huu-builder` had only the worker RUN-step `network=host`, but its container ran on `bridge` — so BuildKit's OWN registry pulls (the `# syntax=docker/dockerfile:1.7` frontend + `node:20-slim` base) failed with TLS-handshake-timeout to registry-1.docker.io, even though the daemon reaches Docker Hub fine (`docker pull` works). Register arm64 emulation first: `docker run --privileged --rm tonistiigi/binfmt --install arm64`. Use `--provenance=false` to keep the manifest to exactly amd64+arm64 (no `unknown/unknown` attestation entries).
- [2026-06-25][source:inference][task:npm-deploy-v2.0.0][probation] GHCR push needs `docker login ghcr.io -u <user> --password-stdin` with a NON-expired classic PAT carrying `write:packages`. Diagnose a `denied: denied` push fast: `curl -sS -D - -o /dev/null -H "Authorization: token <PAT>" https://api.github.com` → `401` means the token is invalid/expired (NOT a scope problem; a valid token returns 200 + an `x-oauth-scopes:` header to check for `write:packages`). The cached buildx build makes a re-push after re-login take seconds.
