/*
 * huu-port-shim — LD_PRELOAD / DYLD_INSERT_LIBRARIES interceptor for bind(2).
 *
 * Why this exists
 * ---------------
 * huu runs N agents in parallel git worktrees. Worktrees isolate the FS, but
 * not the host network: when ten agents each launch `npm run dev` whose code
 * literally calls bind(3000), nine fail with EADDRINUSE — and the agents
 * (correctly believing the code is fine) burn tokens "fixing" a non-bug.
 *
 * Solution: rewrite the port at the bind() boundary, before it reaches the
 * kernel. The customer code stays untouched; the kernel sees a per-agent port.
 *
 * Configuration is via env vars set by huu's orchestrator:
 *   HUU_PORT_REMAP  comma-separated `from:to` pairs, plus optional `*:to`
 *                   default. Example:
 *                     HUU_PORT_REMAP=3000:55100,5432:55101,*:55109
 *                   The `*` form remaps any non-zero port that isn't in the
 *                   explicit table. Port 0 (kernel-chosen ephemeral) is
 *                   always passed through unchanged — rewriting it would
 *                   break tools that intentionally want a random port.
 *   HUU_PORT_DEBUG  if set to a non-empty value, log each remap to stderr.
 *
 * Build
 * -----
 *   Linux : cc -O2 -fPIC -shared -o huu-port-shim.so   port-shim.c -ldl
 *   macOS : cc -O2 -fPIC -dynamiclib -o huu-port-shim.dylib port-shim.c
 *
 * Activation
 * ----------
 *   Linux : LD_PRELOAD=/abs/path/huu-port-shim.so
 *   macOS : DYLD_INSERT_LIBRARIES=/abs/path/huu-port-shim.dylib
 *           DYLD_FORCE_FLAT_NAMESPACE=1
 *           (System Integrity Protection strips DYLD_* for protected
 *           binaries; agents launched by huu are not protected.)
 *
 * Limitations
 * -----------
 * - Static binaries that bypass libc (musl-static Go binaries on Alpine) are
 *   not interceptable. Use a different transport for those.
 * - We do not interpose connect(2): clients are expected to use the remapped
 *   port from `.env.huu`. Connecting to localhost:3000 from a remapped server
 *   would fail — but that's the point: the agent should learn its real port
 *   from the env vars huu provides.
 */

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>

#define HUU_MAX_REMAPS 64

struct huu_remap {
  uint16_t from;
  uint16_t to;
};

static int (*real_bind_fn)(int, const struct sockaddr *, socklen_t) = NULL;
static struct huu_remap huu_remaps[HUU_MAX_REMAPS];
static int huu_num_remaps = 0;
static uint16_t huu_default_port = 0; /* 0 = no catchall */
static int huu_debug = 0;
static pthread_once_t huu_init_once = PTHREAD_ONCE_INIT;

static void huu_parse_remap(const char *spec) {
  if (!spec || !*spec) return;
  char *copy = strdup(spec);
  if (!copy) return;
  char *saveptr = NULL;
  char *tok = strtok_r(copy, ",", &saveptr);
  while (tok && huu_num_remaps < HUU_MAX_REMAPS) {
    char *colon = strchr(tok, ':');
    if (!colon) {
      tok = strtok_r(NULL, ",", &saveptr);
      continue;
    }
    *colon = '\0';
    const char *from_str = tok;
    const char *to_str = colon + 1;
    long to_val = strtol(to_str, NULL, 10);
    if (to_val <= 0 || to_val > 65535) {
      tok = strtok_r(NULL, ",", &saveptr);
      continue;
    }
    if (from_str[0] == '*') {
      huu_default_port = (uint16_t)to_val;
    } else {
      long from_val = strtol(from_str, NULL, 10);
      if (from_val > 0 && from_val <= 65535) {
        huu_remaps[huu_num_remaps].from = (uint16_t)from_val;
        huu_remaps[huu_num_remaps].to = (uint16_t)to_val;
        huu_num_remaps++;
      }
    }
    tok = strtok_r(NULL, ",", &saveptr);
  }
  free(copy);
}

static void huu_init(void) {
  real_bind_fn = (int (*)(int, const struct sockaddr *, socklen_t))dlsym(
      RTLD_NEXT, "bind");
  huu_parse_remap(getenv("HUU_PORT_REMAP"));
  const char *dbg = getenv("HUU_PORT_DEBUG");
  huu_debug = (dbg && *dbg) ? 1 : 0;
  if (huu_debug) {
    fprintf(stderr,
            "[huu-port-shim] loaded: %d explicit remap(s), default=%u\n",
            huu_num_remaps, (unsigned)huu_default_port);
  }
}

static uint16_t huu_lookup(uint16_t orig) {
  if (orig == 0) return 0; /* never remap ephemeral */
  for (int i = 0; i < huu_num_remaps; i++) {
    if (huu_remaps[i].from == orig) return huu_remaps[i].to;
  }
  return huu_default_port; /* 0 if unset → no remap */
}

int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
  pthread_once(&huu_init_once, huu_init);
  if (!real_bind_fn) {
    /* dlsym failed — fail closed rather than crashing the host process. */
    errno = ENOSYS;
    return -1;
  }
  if (!addr) return real_bind_fn(sockfd, addr, addrlen);

  if (addr->sa_family == AF_INET &&
      addrlen >= (socklen_t)sizeof(struct sockaddr_in)) {
    struct sockaddr_in modified;
    memcpy(&modified, addr, sizeof(modified));
    uint16_t orig = ntohs(modified.sin_port);
    uint16_t mapped = huu_lookup(orig);
    if (mapped != 0 && mapped != orig) {
      modified.sin_port = htons(mapped);
      if (huu_debug) {
        fprintf(stderr, "[huu-port-shim] AF_INET bind %u -> %u\n",
                (unsigned)orig, (unsigned)mapped);
      }
      return real_bind_fn(sockfd, (const struct sockaddr *)&modified, addrlen);
    }
  } else if (addr->sa_family == AF_INET6 &&
             addrlen >= (socklen_t)sizeof(struct sockaddr_in6)) {
    struct sockaddr_in6 modified;
    memcpy(&modified, addr, sizeof(modified));
    uint16_t orig = ntohs(modified.sin6_port);
    uint16_t mapped = huu_lookup(orig);
    if (mapped != 0 && mapped != orig) {
      modified.sin6_port = htons(mapped);
      if (huu_debug) {
        fprintf(stderr, "[huu-port-shim] AF_INET6 bind %u -> %u\n",
                (unsigned)orig, (unsigned)mapped);
      }
      return real_bind_fn(sockfd, (const struct sockaddr *)&modified, addrlen);
    }
  }

  return real_bind_fn(sockfd, addr, addrlen);
}
