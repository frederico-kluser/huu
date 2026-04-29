#!/bin/sh
# huu container entrypoint — applies last-mile setup before exec'ing the
# user's command (default: `huu --help`).
#
# The Dockerfile already set `safe.directory '*'` at the system level, but
# in some hardened runtimes `/etc/gitconfig` is read-only at runtime and
# the system entry can be ignored. We re-apply at the user level as a
# fallback. `|| true` makes this idempotent — never fail the run because
# of a config tweak.

set -e

git config --global --add safe.directory '*' >/dev/null 2>&1 || true

# When the user runs `docker run --user 1234:1234`, that UID may not
# exist in /etc/passwd. Without an entry, npm, ssh, and some shell
# builtins emit warnings and HOME is unset. Synthesize a minimal HOME
# pointing at /tmp (writable for any UID) so the rest of the stack
# behaves.
if ! getent passwd "$(id -u)" >/dev/null 2>&1; then
    export HOME="${HOME:-/tmp}"
    mkdir -p "$HOME"
fi

# Ergonomic auto-prepend of `huu`. Without this, the canonical
# `docker run image run pipeline.json` would fail because the entrypoint
# would try to exec a binary named "run" (the args after the image
# replace CMD, and CMD is what the entrypoint exec's).
#
# Strategy: if the first arg is a known shell/runtime/bin or an explicit
# path, exec it as-is — supports `docker run image sh -c '...'` style
# debugging. Otherwise prepend `huu` so users can write subcommands and
# flags directly:
#   docker run image run pipeline.json   -> exec huu run pipeline.json
#   docker run image init-docker         -> exec huu init-docker
#   docker run image --help              -> exec huu --help
#   docker run image huu run x.json      -> exec huu run x.json (no-op prefix)
#   docker run image sh                  -> exec sh
case "${1:-}" in
    ''|huu|sh|bash|dash|node|git|env)
        exec "$@"
        ;;
    /*|./*)
        exec "$@"
        ;;
    *)
        exec huu "$@"
        ;;
esac
