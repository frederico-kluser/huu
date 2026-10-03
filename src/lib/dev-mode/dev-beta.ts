/**
 * Dev-mode BETA signaling — one notice, every entry point.
 *
 * The dev mode IS beta and must say so where the user actually is: the CLI
 * banner and the web dev surface. The wording follows the pattern the research
 * dossier settled on (GitHub Preview / Klaviyo beta revisions / JetBrains EAP):
 * a persistent label + what it means for trust — no SLA, may change or
 * disappear without notice, not for production — plus where feedback goes.
 * What it must NOT do: appear once and vanish (the false-badge lesson) or be
 * implied by absence of warnings.
 */
export const DEV_MODE_BETA_LABEL = 'BETA';

export const DEV_MODE_BETA_NOTICE =
  'huu dev: BETA — modo de desenvolvimento em pré-lançamento. Sem SLA; pode mudar ou ' +
  'desaparecer sem aviso; não usar em produção. Feedback: abra uma issue no repo com a ' +
  'versão do huu (`huu --version`).';
