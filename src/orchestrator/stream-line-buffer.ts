/**
 * Coalesces a stream of text deltas (as emitted by an LLM backend, token by
 * token) into whole lines. Streaming providers hand us arbitrary fragments —
 * sometimes a few characters, sometimes several lines at once — so a delta
 * boundary is NOT a line boundary. This buffer accumulates fragments and
 * yields a line only when a newline actually arrives, which keeps the run log
 * and the browser-console mirror readable (one log entry per real line, not
 * one per network chunk).
 *
 * Pure and synchronous so it can be unit-tested without a live agent.
 */
export class StreamLineBuffer {
  private buf = '';

  /**
   * @param maxLineBytes Force-flush guard: if a single un-terminated line
   *   grows past this, emit it anyway so a provider that streams a huge blob
   *   without newlines (minified output, a long sentence) can't buffer
   *   unboundedly or stall the live view.
   */
  constructor(private readonly maxLineBytes = 4096) {}

  /**
   * Append a delta and return every COMPLETE line it finished. Lines are
   * returned without their trailing `\n` (and without a trailing `\r`, so
   * CRLF output doesn't leave stray carriage returns in the log). A partial
   * trailing line stays buffered for the next push.
   */
  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      out.push(stripCr(this.buf.slice(0, nl)));
      this.buf = this.buf.slice(nl + 1);
    }
    if (this.buf.length > this.maxLineBytes) {
      out.push(stripCr(this.buf));
      this.buf = '';
    }
    return out;
  }

  /**
   * Return any buffered partial line and clear the buffer. Call when the
   * agent reaches a terminal state so the last line (which may lack a
   * trailing newline) isn't dropped. Returns null when nothing is buffered.
   */
  flush(): string | null {
    if (this.buf.length === 0) return null;
    const rest = stripCr(this.buf);
    this.buf = '';
    return rest;
  }
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}
