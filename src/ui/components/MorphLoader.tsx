import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../theme.js';

/**
 * Terminal rendition of huu's morphing gooey blob (the web mark). A terminal
 * can't do SVG goo, so we absorb the *idea*: a liquid "metaball" that swells
 * and slides, drawn with graded Unicode discs. Rendered in `theme.ai` magenta
 * because it marks AI-driven execution (same rule as the rest of the UI).
 */

// Intensity ramp from empty → full disc. The wave maps a smooth bump onto it,
// so the blob reads as liquid mass sliding across the track rather than a
// blinking cursor.
const RAMP = [' ', '·', '∘', '○', '◍', '●'] as const;

/**
 * Precompute frames of a Gaussian bump bouncing left↔right across a track.
 * Pure (no Math.random / Date) so it's deterministic and cheap.
 */
function buildFrames(width: number, frames: number): string[] {
  const sigma = width / 5;
  const out: string[] = [];
  for (let f = 0; f < frames; f++) {
    // Triangle wave 0→(width-1)→0 so the blob eases at both ends.
    const t = f / frames;
    const center = (width - 1) * (1 - Math.abs(1 - 2 * t));
    let row = '';
    for (let i = 0; i < width; i++) {
      const d = i - center;
      const v = Math.exp(-(d * d) / (2 * sigma * sigma)); // 0..1
      const idx = Math.min(RAMP.length - 1, Math.round(v * (RAMP.length - 1)));
      row += RAMP[idx];
    }
    out.push(row);
  }
  return out;
}

const LOADER_FRAMES = buildFrames(13, 24);
// A compact morph glyph cycle for the inline header mark.
const MARK_FRAMES = ['◜', '◝', '◞', '◟', '◠', '◡', '○', '◍'] as const;

export interface MorphLoaderProps {
  label?: string;
  intervalMs?: number;
}

/** Full, centered startup loader: animated blob + wordmark + label. */
export function MorphLoader({
  label = 'Spinning up agents…',
  intervalMs = 90,
}: MorphLoaderProps): React.JSX.Element {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % LOADER_FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  const frame = LOADER_FRAMES[i] ?? LOADER_FRAMES[0] ?? '';
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1} width="100%">
      <Text bold color={theme.aiAccent}>
        {frame}
      </Text>
      <Box marginTop={1}>
        <Text bold color={theme.ai}>
          h
        </Text>
        <Text bold color={theme.aiAccent}>
          u
        </Text>
        <Text bold color={theme.ai}>
          u
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{label}</Text>
      </Box>
    </Box>
  );
}

export interface MorphMarkProps {
  /** Pause the animation (e.g. once the run is done). */
  active?: boolean;
  intervalMs?: number;
}

/** Tiny inline morphing glyph — a continuously-animating mark for the header. */
export function MorphMark({
  active = true,
  intervalMs = 130,
}: MorphMarkProps): React.JSX.Element {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setI((n) => (n + 1) % MARK_FRAMES.length), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  const glyph = active ? (MARK_FRAMES[i] ?? MARK_FRAMES[0]) : '●';
  return <Text color={theme.aiAccent}>{glyph}</Text>;
}
