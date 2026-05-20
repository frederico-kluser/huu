# Hardening Roadmap

> Six gaps identified during the post-Phase-6 review. This document is the
> implementation plan; execute it bottom-up (each section is self-contained).
> Each item gets its own conventional commit so reverts are surgical.
>
> **Status:** ✅ all six items shipped. Each section's "implementation"
> notes describe what landed; check the commit referenced inline for the
> actual diff.
>
> **Histórico — GitHub Actions removida em commit posterior.** Os
> trechos abaixo que mencionam `metadata-action`, `docker.yml` ou
> `.github/workflows/` referem-se ao estado anterior do projeto e são
> mantidos para auditoria. O fluxo atual é manual — ver `AGENTS.md`
> "Release procedure" e `docker-roadmap.md` Item 1.

| Item | Commit | Status |
|---|---|---|
| #5 — env vars docs | `6632fba` | ✅ done |
| #2 — version + CHANGELOG | `218eef8` | ✅ done |
| #6 — `huu prune` | `d66e7a8` | ✅ done |
| #10 + #3 — secret leaks | `1da99b8` | ✅ done |
| #9 — pull UX | `6dd3154` | ✅ done |

## Index

1. [#5 — env vars missing from the README table](#5--env-vars-missing-from-the-readme-table) — pure docs
2. [#2 — version bump + CHANGELOG](#2--version-bump--changelog) — release plumbing
3. [#6 — `huu prune` manual subcommand](#6--huu-prune-manual-subcommand) — new feature
4. [#10 — `OPENROUTER_API_KEY` in `ps aux`](#10--openrouter_api_key-in-ps-aux) — narrow argv fix
5. [#3 — `OPENROUTER_API_KEY` in `docker inspect`](#3--openrouter_api_key-in-docker-inspect) — secret-file mount
6. [#9 — first-run pull UX](#9--first-run-pull-ux) — pre-flight check

Items #10 and #3 share infrastructure (env passing strategy) and ship in
one commit.

---

## #5 — env vars missing from the README table

**Problem.** Phase 6 added `HUU_IMAGE`, `HUU_NO_DOCKER`, and (Phase 1)
`HUU_DOCKER_PASS_ENV` without surfacing them in the README's
"Environment variables" table. Users grep the README for these names
and find nothing.

**Fix.** Append three rows to the table in both `README.md` and
`README.pt-BR.md`:

```markdown
| `HUU_IMAGE` | no | Override the default container image (default: `ghcr.io/frederico-kluser/huu:latest`). Useful for pinning a release or pointing at a private mirror. |
| `HUU_NO_DOCKER` | no | When set to `1` or `true`, skip the auto-Docker re-exec and run huu natively (requires the local `npm install`). |
| `HUU_DOCKER_PASS_ENV` | no | Whitespace-separated list of additional env var names to forward into the container (the wrapper always forwards `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE`, `HUU_CHECK_PUSH`, `HUU_WORKTREE_BASE`, `TERM`). |
```

**Risk.** Zero — pure docs.

**Test.** Manual review.

---

## #2 — version bump + CHANGELOG

**Problem.** `package.json` is `0.1.0` and the docker re-exec is a
behavior change: typing `huu` now spawns a container instead of running
natively. There's no `CHANGELOG.md`, so a user pinning to `0.1.0` and
later upgrading has no way to discover what changed without reading the
git log. The CI's `metadata-action` only emits `:latest` and `:main`
because no semver tag exists.

**Fix.**

1. Bump `package.json` to `0.2.0` (semver 0.x.x allows breaking changes
   on minor bumps; documented at semver.org).
2. Add `CHANGELOG.md` following [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/):
   - `## [0.2.0] - 2026-04-28` section with subsections **Added /
     Changed / Fixed / Security** describing the seven docker phases.
   - `## [0.1.0] - <date of initial commit>` placeholder for prior state.
3. Document the release procedure in `AGENTS.md`:
   ```bash
   # Bump version, write CHANGELOG entry, then:
   git tag v0.2.0
   git push origin v0.2.0
   # The docker.yml workflow takes over: builds multi-arch, publishes
   # huu:0.2.0, huu:0.2, huu:0, huu:latest to GHCR.
   ```
4. Add a `release-notes` script to `package.json`:
   ```json
   "release-notes": "git log --pretty=format:'- %s' v$(node -p \"require('./package.json').version\")..HEAD"
   ```
   (Prints commits since the current package.json version. Useful when
   drafting the next CHANGELOG entry.)

**Risk.** Low. The semver bump is only meaningful once the package is
actually published — neither npm nor GHCR is publishing today, so this
is preparation, not breakage.

**Test.** Manual: `npm pack` to verify the tarball metadata; tag the
commit locally and confirm `metadata-action` (in CI) would generate the
expected tag set.

---

## #6 — `huu prune` manual subcommand

**Problem.** `pruneOrphans()` runs automatically at the start of every
re-exec invocation, but users have no way to *list* lingering huu
containers, see their state, or force cleanup outside of the
auto-prune path. Operationally: a user whose pipeline crashed wants to
ask "did anything survive?" and there's no answer.

**Fix.** Add a non-TUI subcommand:

```
huu prune                     # kill all running huu containers, remove cidfiles
huu prune --list              # print the labeled containers and their ages, exit 0
huu prune --dry-run           # show what `huu prune` WOULD kill, exit 0
```

**Implementation.**

1. New file `src/lib/prune.ts`:
   - `findHuuContainers()` — `docker ps --filter label=org.opencontainers.image.source=huu-wrapper --format '{{json .}}'`, parse one JSON per line
   - `findStaleCidfiles(cidfileDir)` — return cidfiles whose parent PID is dead
   - `runPruneCli(args, cwd)` — flag parsing and orchestration

2. Wire into `src/cli.tsx`:
   - Add `'prune'` to `NON_TUI_SUBCOMMANDS`
   - Add `'prune'` to `NATIVE_ONLY_SUBCOMMANDS` in `decideReexec` (it inspects host docker, not container)
   - Dispatch in main(): `if (filtered[0] === 'prune') process.exit(runPruneCli(filtered.slice(1), process.cwd()));`

3. Update `printUsage()` and the `huu --help` flags section.

4. Tests in `src/lib/prune.test.ts`:
   - Mock `docker ps` output, verify parsing of labeled containers
   - Mock cidfile dir, verify stale detection (test PIDs dead/alive/EPERM)
   - CLI flag matrix: bare `huu prune`, `--list`, `--dry-run`

5. README: add a one-paragraph entry under "Run with Docker" explaining
   when `huu prune` is useful (after `kill -9` of a wrapper, or when
   the user sees orphans they want to inspect).

**Risk.** Additive feature. Worst case: a bug in the parser misses
some orphans, in which case the user sees them via `docker ps` and
kills them by hand — same as today.

**Test plan.**
- `huu prune --dry-run` against zero containers → "no huu containers"
- Spawn a long-running huu container, then `huu prune --list` from a
  second shell → shows it
- Then `huu prune` → kills it, exit 0
- `huu prune --json` (consider adding) for scriptable output

---

## #10 — `OPENROUTER_API_KEY` in `ps aux`

**Problem.** `buildDockerArgv()` emits `-e OPENROUTER_API_KEY=sk-or-…`,
which lands in the docker client's `argv`. During the brief window
between `spawn()` and the docker daemon reading the request,
`/proc/<docker-cli-pid>/cmdline` exposes the key to anyone with read
access on the host (e.g., other users via `ps auxf` on a shared box).

**Fix.** Switch to the [valueless `-e` form](https://docs.docker.com/reference/cli/docker/container/run/):
when you write `--env OPENROUTER_API_KEY` (no `=value`), the docker
client reads the value from its own process env at run time and passes
it to the container via the daemon socket. The argv contains only the
variable NAME — not the value.

This fix lands in the same commit as #3 because the env-passing
strategy is changing for all forwarded vars.

**Implementation.**

```ts
// in buildDockerArgv, replace:
argv.push('-e', `${k}=${process.env[k]}`);
// with:
argv.push('-e', k);
```

Update the existing tests in `docker-reexec.test.ts` to assert on the
new shape:
```ts
expect(argv).toContain('-e');
expect(argv).toContain('OPENROUTER_API_KEY');
expect(argv.find((a) => a.startsWith('OPENROUTER_API_KEY='))).toBeUndefined();
```

**Risk.** Low. The behavioral contract for the container is identical
— the var arrives in `process.env` either way.

**Edge case.** If the wrapper's caller exports the var inside a
subshell that no longer exists by the time docker forwards, the lookup
yields empty. Not a real concern: `spawn` inherits the wrapper's env
verbatim, so docker resolves against the wrapper's exact env.

---

## #3 — `OPENROUTER_API_KEY` in `docker inspect`

**Problem.** Even after fixing #10, the value still appears in
`docker inspect <cid> --format '{{.Config.Env}}'` for anyone with
docker socket access. We added a server-side secret resolver in
`lib/api-key.ts` (Phase 3) that reads `/run/secrets/openrouter_api_key`
first — but the wrapper never uses that path. We documented Compose
secrets but didn't implement the same for the auto-reexec.

**Fix.** When `OPENROUTER_API_KEY` is set in the wrapper's env, write
it to a host temp file with `chmod 0600`, bind-mount that file into the
container at `/run/secrets/openrouter_api_key`, and DON'T pass it as
`-e`. The container's existing `resolveOpenRouterApiKey()` already
reads `/run/secrets/openrouter_api_key` first.

**Implementation.**

1. New helper in `lib/docker-reexec.ts`:
   ```ts
   function makeSecretFile(value: string): string {
     // Prefer /dev/shm on Linux (tmpfs, never hits disk). Fallback to
     // os.tmpdir() on Mac/Windows where /dev/shm doesn't exist.
     const shmPath = '/dev/shm';
     const baseDir = existsSync(shmPath) ? shmPath : tmpdir();
     const path = join(baseDir, `huu-secret-${process.pid}-${randomBytes(8).toString('hex')}`);
     writeFileSync(path, value, { mode: 0o600 });
     return path;
   }
   ```

2. Modify `buildDockerArgv` to:
   - Skip `OPENROUTER_API_KEY` from the env passthrough loop
   - Accept a `secretMounts: { hostPath: string, containerPath: string }[]`
     parameter that emits `--mount type=bind,src=...,dst=...,readonly`

3. In `reexecInDocker`, before calling `buildDockerArgv`:
   ```ts
   const secretMounts: { hostPath: string; containerPath: string }[] = [];
   if (process.env.OPENROUTER_API_KEY) {
     secretMounts.push({
       hostPath: makeSecretFile(process.env.OPENROUTER_API_KEY),
       containerPath: '/run/secrets/openrouter_api_key',
     });
   }
   // ... pass secretMounts to buildDockerArgv ...
   // and unlink them in the finally cleanup along with the cidfile
   ```

4. Update existing test `'passes through OPENROUTER_API_KEY when set'`:
   - Now assert the key is NOT in the argv
   - Assert a `--mount type=bind,…dst=/run/secrets/openrouter_api_key,readonly` flag is present

5. README: update the "Docker secrets" subsection to note that the
   auto-reexec wrapper now uses the same secret-file path that Compose
   does — the user gets the protection automatically without writing
   any compose config.

**Risk.** Medium. New filesystem interactions on the host. Edge cases:
- `/dev/shm` not writable (rare, sandboxed containers): falls back to
  `os.tmpdir()`.
- Wrapper SIGKILL'd before unlink: file lingers in `/dev/shm` (memory)
  or `os.tmpdir()` with mode 0600. The orphan-prune logic should also
  clean these up — extend `pruneOrphans()` to handle stale
  `huu-secret-*` files.
- macOS Docker Desktop bind mounts files via VirtioFS — bind mount of
  a host file should work but isn't tested locally on Mac. If issues:
  fall back to writing to a tmpfs volume the container creates and
  letting the API key resolver in `lib/api-key.ts` use a different
  path conveyed via `OPENROUTER_API_KEY_FILE`.

**Test plan.**
- Unit: assert `buildDockerArgv` no longer emits `-e OPENROUTER_API_KEY`
  when `secretMounts` includes it
- E2E: spawn `huu --stub`, then `docker inspect <cid> --format '{{.Config.Env}}'`
  — assert `OPENROUTER_API_KEY=` is NOT present
- E2E: same run, `docker exec <cid> cat /run/secrets/openrouter_api_key`
  — assert the key is readable from inside the container
- Cleanup: after wrapper exits, assert the `/dev/shm/huu-secret-*` file
  is gone

---

## #9 — first-run pull UX

**Problem.** On a fresh machine, `docker run ghcr.io/.../huu:latest`
triggers a 600 MB image pull. The wrapper just calls `spawn('docker',
['run', ...])`, so docker's own progress UI handles the pull, but our
side prints nothing — users may not realize what's happening or how
long to wait.

**Fix.** Detect "image not present locally" and print a friendly
message before exec'ing docker run.

**Implementation.**

```ts
function imageIsLocal(image: string): boolean {
  const r = spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' });
  return r.status === 0;
}

// in reexecInDocker, before spawn:
const image = process.env.HUU_IMAGE ?? DEFAULT_IMAGE;
if (!imageIsLocal(image)) {
  process.stderr.write(
    `huu: pulling ${image} (~600MB, first time only — subsequent runs are instant)\n`,
  );
}
```

`docker run` will pull on demand; we just front-load a sentence so the
user understands what the slow first second is.

**Risk.** Low. Worst case: `docker image inspect` fails for some
unrelated reason and we print the message every run — annoying but not
broken.

**Future enhancement.** A `huu pull` subcommand that the user can run
once during onboarding to do the pull explicitly. Out of scope for
this hardening pass.

**Test plan.**
- Manual: `docker rmi ghcr.io/.../huu:latest`, then `huu --help` (no,
  that's native — try `huu --stub` or any TUI invocation), observe the
  message before docker's pull progress
- Manual: second run, no message, instant start
- Unit: a test that mocks `spawnSync` to return non-zero from
  `image inspect` and asserts `process.stderr.write` is called

---

## Order of execution

```
1. #5 (env vars)        — pure docs, low risk, fastest dopamine
2. #2 (version + CHANGELOG) — pure config, prepares for tagged release
3. #6 (huu prune)       — additive new feature, doesn't touch hot paths
4. #10 + #3 (secrets)   — single commit; biggest behavior change
5. #9 (pull UX)         — narrow polish
```

Each step:
1. Implement
2. Add/update unit tests; `npm test` clean
3. `npm run typecheck` clean
4. Build the docker image, run a manual smoke test where applicable
5. Conventional commit (`fix(docker)` / `feat(cli)` / `docs`)
6. `git push`

Don't bundle multiple items into one commit — they're independently
revertable for a reason.
