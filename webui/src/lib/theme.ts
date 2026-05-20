// Mirrors src/ui/theme.ts. The 'ai' token (fuchsia/magenta) is RESERVED for
// AI-driven UI: Smart Select, Pipeline Assistant, Project Recon, agent logs.
// See AGENTS.md > Visual conventions.

export const themeTokens = {
  ai: 'hsl(var(--ai))',
  border: 'hsl(var(--border))',
  success: 'hsl(var(--success))',
  warning: 'hsl(var(--warning))',
  error: 'hsl(var(--error))',
  info: 'hsl(var(--info))',
} as const;

export type ThemeToken = keyof typeof themeTokens;
