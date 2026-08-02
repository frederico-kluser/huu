import { homedir } from 'node:os';

/**
 * Resolves the base directory that holds huu's persistent state
 * (`~/.huu/pipeline-memory.json`, `~/.huu/pipelines/`, model recents,
 * default Downloads target for exports).
 *
 * In the Docker wrapper path, `docker-reexec.ts` bind-mounts the host's
 * `~/.huu` (and, when present, `~/Downloads`) into the container at the
 * same absolute path and sets `HUU_HOST_HOME` to the host's home. The
 * in-container code reads HUU_HOST_HOME via this helper so saves land on
 * the host filesystem instead of the container's ephemeral $HOME (which
 * vanishes on `docker run --rm`).
 *
 * Outside Docker (`--yolo`, `HUU_NO_DOCKER`, native-only subcommands)
 * HUU_HOST_HOME is unset and this falls through to `homedir()` — the
 * native install just uses its own home, behavior unchanged.
 */
export function getHuuHome(): string {
  const override = process.env.HUU_HOST_HOME?.trim();
  return override && override.length > 0 ? override : homedir();
}
