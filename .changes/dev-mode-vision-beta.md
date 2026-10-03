### Added

- **Modo DEV com visão, prints analisados e sinalização BETA.** Todos os modos
  sugerem agora `xiaomi/mimo-v2.6-pro` (omni-modal, verificado ao vivo na API
  da OpenRouter) e o modo DEV **exige** um modelo com visão — pré-flight nas
  duas fronteiras (CLI `runDevCli` e `WebDevManager.start`) que recusa com
  mensagem acionável (trocar de modelo · curar `inputModalities` · `--stub`),
  nunca em silêncio. Prints chegam por `--print=<img>`/`--capture[=region|window|full]`
  (CLI) e por upload no formulário web (8×5MB, validado no servidor); cada um é
  analisado por **side-call de visão com disclosure** — o backend jcode não
  entrega imagens ao modelo (sonda 2026-10-03), logo a análise viaja como texto
  de segundo grau anunciado. Captura própria via `screencapture` (macOS,
  seleção interativa = revisão) e espectacle/grim/gnome-screenshot (Linux);
  captura só guarda (`.huu/prints/`), o envio é ato explícito. O modo DEV
  sinaliza **BETA** nas três superfícies (banner CLI, badge web com tooltip
  i18n en/pt-BR, título do dashboard TUI): sem SLA, pode mudar sem aviso, não
  usar em produção.

### Changed

- `recommended-models.json` e o catálogo in-code ganham `inputModalities`
  (curado da API da OpenRouter, 2026-10-03 — 14 modelos, 8 com imagem), com
  `xiaomi/mimo-v2.6-flash` (omni barato) e preços corrigidos dos MiMo; o
  contrato `ModelEntry` aceita a modalidade `file`. Os presets do modo DEV
  (`hetero`/`thrifty`/`monoculture`/`roster`) passaram a rosters de visão —
  líder `mimo-v2.6-pro`, swarm `mimo-v2.6-flash`, demovido `glm-5.3-flash`,
  crítico cross-family `kimi-k2.6` — porque o gate recusava os rosters
  antigos (DeepSeek/glm-5.2 são só-texto).
