// Central color tokens. `theme.ai` (magenta) is reserved for AI-driven UI —
// Smart Select, Pipeline Assistant, Project Recon, agent logs. Non-AI
// components must not introduce magenta. See README "Visual conventions".

export const theme = {
  ai: 'magenta',
  aiAccent: 'magentaBright',
  border: 'cyan',
  cursor: 'cyan',
  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'blue',
} as const;

export type ThemeColor = (typeof theme)[keyof typeof theme];
