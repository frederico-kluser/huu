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

# Inherit host git identity. The wrapper reads git config user.name/email
# on the host and forwards them as GIT_AUTHOR_NAME / GIT_COMMITTER_NAME /
# GIT_AUTHOR_EMAIL / GIT_COMMITTER_EMAIL. We also write them into the
# container's global gitconfig so tools that clear env still see them.
if [ -n "$GIT_AUTHOR_NAME" ]; then
    git config --global user.name "$GIT_AUTHOR_NAME" >/dev/null 2>&1 || true
fi
if [ -n "$GIT_AUTHOR_EMAIL" ]; then
    git config --global user.email "$GIT_AUTHOR_EMAIL" >/dev/null 2>&1 || true
fi

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
