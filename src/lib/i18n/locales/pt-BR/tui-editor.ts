/** TUI Ink — editores, assistente, home, FAQ, resumo. Gêmeo de `en/tui-editor.ts`. */

export const tuiEditorPtBR = {
  'tui.editor.pattern_title': 'Novo pipeline — qual é o formato do seu método?',
  'tui.editor.pattern_discover_act': 'Descobrir → Agir',
  'tui.editor.pattern_discover_act_hint':
    'dois passos ligados: um acha os arquivos, o outro corrige cada um em paralelo ($hint carrega o porquê)',
  'tui.editor.pattern_per_file': 'Transformação por arquivo',
  'tui.editor.pattern_per_file_hint':
    'o mesmo prompt sobre N arquivos que você escolhe, em paralelo ($file)',
  'tui.editor.pattern_fan_join': 'Fan-out → Junção (diamante)',
  'tui.editor.pattern_fan_join_hint':
    'preparação, depois dois ramos EM PARALELO (ondas) e uma junção que enxerga os dois',
  'tui.editor.pattern_audit_judge': 'Auditoria com juiz',
  'tui.editor.pattern_audit_judge_hint':
    'auditoria somente-relatório + uma verificação que volta para retrabalho',
  'tui.editor.pattern_blank': 'Em branco',
  'tui.editor.pattern_blank_hint': 'começar de um único passo vazio',
  'tui.editor.hint_choose': 'escolher',
  'tui.editor.hint_scaffold': 'gerar o esqueleto',

  'tui.editor.prob_unnamed': 'sem nome — ENTER, depois edite o Nome',
  'tui.editor.prob_dep_unknown':
    'dependsOn aponta para o passo desconhecido "{dep}" — ENTER, depois refaça as Deps',
  'tui.editor.prob_dep_not_earlier':
    'dependsOn "{dep}" não é um passo ANTERIOR — ENTER, depois refaça as Deps',
  'tui.editor.prob_no_condition': 'condição vazia — ENTER, depois edite a Condição',
  'tui.editor.prob_default_outcome':
    'precisa de exatamente um resultado padrão — ENTER para editar os resultados',
  'tui.editor.prob_outcome_dangling':
    'o resultado "{label}" não aponta para nenhum passo — ENTER para corrigir',
  'tui.editor.prob_no_prompt': 'prompt vazio — ENTER, depois E abre o $EDITOR',
  'tui.editor.prob_memory_unlinked':
    'memória não vinculada — ENTER, depois o campo Arquivos liga um produtor',
  'tui.editor.prob_per_file_empty': 'per-file sem arquivos — ENTER, depois F escolhe',
  'tui.editor.problem_line': '⚠ passo #{index}: {problem}',

  'tui.editor.hint_reorder': 'reordenar',
  'tui.editor.hint_new_work': 'novo work',
  'tui.editor.hint_new_check': 'novo check',
  'tui.editor.hint_rename': 'renomear',
  'tui.editor.hint_settings': 'configurações',
  'tui.editor.hint_import': 'importar',

  'tui.editor.rename_title': 'Renomear pipeline',
  'tui.editor.step_count_one': '{count} passo',
  'tui.editor.step_count_other': '{count} passos',
  'tui.editor.badge_check': 'check',
  'tui.editor.badge_work': 'work',
  'tui.editor.badge_project': 'projeto',
  'tui.editor.badge_no_default': 'sem padrão',
  'tui.editor.badge_memory_unlinked': 'memória (não vinculada)',
  'tui.editor.badge_per_file_empty': 'per-file (sem arquivos)',
  'tui.editor.badge_per_file': 'per-file · {count}',
  'tui.editor.badge_flex_project': 'flex · projeto inteiro',
  'tui.editor.badge_flex_files_one': 'flex · {count} arquivo',
  'tui.editor.badge_flex_files_other': 'flex · {count} arquivos',
  'tui.editor.badge_root': 'raiz',
  'tui.editor.model_global': 'global',
  'tui.editor.settings_line':
    'timeout do card: {whole}min (multi/projeto inteiro) · {single}min (arquivo único) · retentativas: {retries} · integração 🧠',

  'tui.settings.title': 'Configurações do pipeline',
  'tui.settings.subtitle':
    'Os timeouts valem POR CARD. Não há limite de tempo para o pipeline como um todo.',
  'tui.settings.card_timeout': 'Timeout do card de projeto:',
  'tui.settings.single_timeout': 'Timeout do card de arquivo único:',
  'tui.settings.max_retries': 'Máx. de retentativas por card:',
  'tui.settings.unit_min': 'min',
  'tui.settings.integration_model': 'Modelo do agente de integração:',
  'tui.settings.integration_global': 'global (modelo da execução)',
  'tui.settings.hint_cycle': 'circular',
  'tui.settings.hint_pick_model': 'escolher modelo',
  'tui.settings.hint_clear_model': 'limpar (usar o global)',
  'tui.settings.hint_save_close': 'salvar e fechar',
  'tui.settings.hint_fix_first': 'cancelar — corrija os campos inválidos antes',
  'tui.settings.hint_exit_editing': 'sair da edição',

  'tui.step.title': 'Editar passo #{index}',
  'tui.step.current': 'atual',
  'tui.step.field_prompt': 'Prompt:',
  'tui.step.field_scope': 'Escopo:',
  'tui.step.field_deps': 'Deps:',
  'tui.step.field_files': 'Arquivos:',
  'tui.step.field_model': 'Modelo:',
  'tui.step.name_placeholder': 'ex.: Refatorar cabeçalhos',
  'tui.step.prompt_placeholder':
    'Use $file quando houver arquivos selecionados ($hint no escopo memory)',
  'tui.step.prompt_empty': '(vazio — E abre o $EDITOR)',
  'tui.step.prompt_lines': '{count} linhas',
  'tui.step.model_default': '(modelo da execução)',
  'tui.step.scope_title': 'Escopo do passo #{index} — como ele se decompõe em agentes?',
  'tui.step.scope_footer': '↑↓ escolher · ENTER aplicar · ESC manter o atual',
  'tui.step.scope_opt_project': 'project',
  'tui.step.scope_opt_per_file': 'per-file',
  'tui.step.scope_opt_memory': 'memory',
  'tui.step.scope_opt_flexible': 'flexible',
  'tui.step.scope_why_project':
    'um agente vê o repositório inteiro — setup, builds, artefatos únicos',
  'tui.step.scope_why_per_file':
    'um agente por arquivo que VOCÊ escolhe — paralelo, $file no prompt',
  'tui.step.scope_why_memory':
    'um agente por arquivo que um passo ANTERIOR descobre — $file + $hint',
  'tui.step.scope_why_flexible': 'legado: decidir arquivos vs projeto inteiro na hora da edição',
  'tui.step.scope_state_project': 'projeto inteiro (travado)',
  'tui.step.scope_state_per_file': 'por arquivo (precisa escolher arquivos)',
  'tui.step.scope_state_memory': 'arquivo de memória (caminhos de um passo anterior)',
  'tui.step.scope_state_flexible': 'flexível (escolhe na hora da edição)',
  'tui.step.deps_title':
    'Dependências do passo #{index} — passos que ele precisa esperar (ondas paralelas)',
  'tui.step.deps_none_available': '(não há passos anteriores — este só pode ser uma raiz)',
  'tui.step.deps_footer':
    'SPACE alterna · ENTER aplica · D padrão (passo anterior) · R raiz (onda 1) · ESC cancela',
  'tui.step.deps_default': '(passo anterior — cadeia padrão)',
  'tui.step.deps_root': '(raiz — roda na onda 1)',
  'tui.step.deps_needs': 'precisa de: {list}',
  'tui.step.mem_title': 'Arquivo de memória — de onde vem a lista de arquivos deste passo?',
  'tui.step.mem_footer': '↑↓ escolher · ENTER selecionar · ESC voltar',
  'tui.step.mem_produced_by': '← produzido pelo passo #{index} "{name}"',
  'tui.step.mem_pick_producer': '⚲ escolher um passo anterior para produzi-lo…',
  'tui.step.mem_pick_producer_hint':
    'o huu liga os dois lados e anexa o contrato de formato àquele passo automaticamente',
  'tui.step.mem_custom_path': '✎ caminho personalizado (avançado)',
  'tui.step.mem_custom_path_hint':
    'digite um caminho que o prompt produtor escreve manualmente',
  'tui.step.link_title': 'Qual passo anterior deve produzir {path}?',
  'tui.step.link_footer': '↑↓ escolher · ENTER ligar os dois lados · ESC voltar',
  'tui.step.link_moves':
    'já produz {current} — escolhê-lo move a promessa para {path}',
  'tui.step.link_contract':
    'o huu anexa o MEMORY CONTRACT (caminho exato + formato + limite) ao prompt dele em tempo de execução',
  'tui.step.files_memory_from': 'memória ← {path}',
  'tui.step.files_not_linked': '(não vinculado — aperte ENTER para escolher o arquivo de memória)',
  'tui.step.files_locked': '[projeto inteiro — travado pelo escopo]',
  'tui.step.files_none_pick': '(sem arquivos — aperte ENTER ou F para escolher)',
  'tui.step.files_no_choice':
    '(sem escolha — aperte F para arquivos ou W para o projeto inteiro)',
  'tui.step.files_whole_once': '[projeto inteiro — roda uma vez, sem escopo de arquivo]',
  'tui.step.files_selected': '{count} arquivo(s) selecionado(s)',
  'tui.step.produces': '→ produz: {path}',
  'tui.step.produces_hint':
    'o huu anexa o contrato de formato a este prompt em tempo de execução',
  'tui.step.err_no_editor':
    'defina $EDITOR (ex.: export EDITOR=nano) para editar prompts multilinha',
  'tui.step.err_editor_failed': 'o editor falhou: {message}',
  'tui.step.foot_editing': 'digite · ENTER confirma · ESC para de editar',
  'tui.step.foot_name': 'ENTER edita o nome',
  'tui.step.foot_prompt': 'ENTER edita inline · E abre no $EDITOR (multilinha)',
  'tui.step.foot_scope':
    'ENTER escolhe da lista · P project · F per-file · X flexible · M memory',
  'tui.step.foot_deps':
    'ENTER escolhe dependências — declarar qualquer dependsOn muda a execução para ondas paralelas',
  'tui.step.foot_files_locked': 'travado pelo escopo — projeto inteiro',
  'tui.step.foot_files_memory': 'ENTER vincula um arquivo de memória',
  'tui.step.foot_unlink': 'U desvincula',
  'tui.step.foot_stop_producing': 'O para de produzir',
  'tui.step.foot_files_pick': 'ENTER/F escolhe arquivos',
  'tui.step.foot_files_flex': 'F escolhe arquivos · W projeto inteiro',
  'tui.step.foot_files_flex_choose': 'F escolhe arquivos · W projeto inteiro (escolha um)',
  'tui.step.foot_model': 'ENTER/M escolhe modelo · C limpa (usa o modelo da execução)',
  'tui.step.hint_field': 'campo',
  'tui.step.hint_save': 'salvar passo',
  'tui.step.hint_cancel_incomplete': 'cancelar (incompleto)',

  'tui.assistant.title': 'Assistente de Pipeline',
  'tui.assistant.model_purpose':
    'Este modelo conduz a entrevista E o arquiteto (3 esboços em paralelo → seleção → prompts por passo).',
  'tui.assistant.model_advice':
    'Planejar é a maior alavanca — um modelo forte aqui se paga na execução inteira. Sugeridos:',
  'tui.assistant.model_default': 'Padrão: {model}',
  'tui.assistant.model': 'Modelo: {model}',
  'tui.assistant.model_turn': 'Modelo: {model} · Turno {turn}',
  'tui.assistant.intent_question': 'O que você quer que o pipeline faça?',
  'tui.assistant.intent_hint': 'Descreva em uma ou duas frases. Seja concreto.',
  'tui.assistant.hint_start': 'começar',
  'tui.assistant.hint_send': 'enviar',
  'tui.assistant.speaker_you': 'Você:',
  'tui.assistant.speaker_assistant': 'Assistente:',
  'tui.assistant.thinking': 'pensando...',
  'tui.assistant.free_text_hint': 'Digite sua resposta livre:',
  'tui.assistant.architect_title': 'Arquiteto de Pipeline',
  'tui.assistant.architect_subtitle':
    'Modelo: {model} · esboços em paralelo → seleção → prompts por passo → validação',
  'tui.assistant.architect_starting': 'iniciando o arquiteto…',
  'tui.assistant.discard_title': 'Descartar a conversa?',
  'tui.assistant.discard_body':
    'Você perderá o contexto reunido até agora e voltará para a tela inicial.',
  'tui.assistant.discard_yes': 'sim, descartar',
  'tui.assistant.discard_no': 'continuar',
  'tui.assistant.error_title': 'Erro do assistente',
  'tui.assistant.error_hint': 'Aperte ESC para voltar.',

  'tui.home.tagline': 'Execução guiada de pipelines — kanban multi-agente com worktrees do git',
  'tui.home.menu_assistant': 'Assistente de Pipeline',
  'tui.home.menu_new': 'Novo pipeline',
  'tui.home.menu_import': 'Importar pipeline da lista',
  'tui.home.menu_saved': 'Pipelines salvos',
  'tui.home.menu_dir': 'Diretório de execução — navegar e escolher onde rodar',
  'tui.home.menu_projects': 'Rodar em vários projetos — marque pastas, uma fila',
  'tui.home.menu_options': 'Opções — orçamento de RAM e chaves dos provedores de IA',
  'tui.home.menu_faq': 'FAQ — perguntas frequentes',
  'tui.home.menu_quit': 'Sair',
  'tui.home.available': 'Pipelines disponíveis em ./pipelines:',
  'tui.home.hint_load': 'carregar o selecionado',
  'tui.home.hint_jump': 'pular para',
  'tui.home.run_dir': 'diretório de execução: {dir}',
  'tui.home.hint_change': 'trocar',
  'tui.home.pick_pipelines_title': 'Escolha os pipelines para rodar nos projetos',
  'tui.home.pick_pipelines_sub_one':
    '{count} projeto marcado — cada pipeline roda uma vez por projeto',
  'tui.home.pick_pipelines_sub_other':
    '{count} projetos marcados — cada pipeline roda uma vez por projeto',
  'tui.home.resolver_title': 'Modelo resolvedor de conflitos (opcional)',
  'tui.home.resolver_body':
    'Escolha um modelo (mais forte) para resolver conflitos de merge durante a integração — ele roda no máximo de raciocínio. Aperte Esc para usar o modelo da execução.',

  'tui.faq.subtitle': 'Respostas curtas para as dúvidas mais comuns.',
  'tui.faq.any_key': 'qualquer tecla — voltar',
  'tui.faq.what_is_huu_q': 'O que é o huu?',
  'tui.faq.what_is_huu_a':
    'Uma TUI que orquestra pipelines de agentes LLM em paralelo, cada um isolado na própria worktree do git, com merge determinístico ao fim de cada estágio.',
  'tui.faq.what_is_pipeline_q': 'O que é um pipeline?',
  'tui.faq.what_is_pipeline_a':
    'Uma sequência de passos. Cada passo se decompõe em N tarefas que rodam em paralelo; o estágio só avança depois de mesclar as tarefas na worktree de integração.',
  'tui.faq.modifies_repo_q': 'O huu modifica o meu repositório?',
  'tui.faq.modifies_repo_a':
    'Não. Toda execução acontece em worktrees irmãs do git. A branch atual continua intacta; o resultado vira uma branch nova que você decide se mescla.',
  'tui.faq.providers_q': 'Quais provedores de LLM são suportados?',
  'tui.faq.providers_a':
    'O huu roda através do pi. Escolha o provedor por baixo dele: OpenRouter (padrão) ou Azure AI Foundry. O stub (mock sem LLM, para smoke tests) fica acessível via --stub.',
  'tui.faq.api_key_q': 'Preciso de uma chave de API?',
  'tui.faq.api_key_a':
    'Sim. OpenRouter precisa de OPENROUTER_API_KEY; Azure AI Foundry precisa de AZURE_OPENAI_API_KEY + AZURE_OPENAI_BASE_URL. As chaves são pedidas sob demanda e salvas localmente ([O] Opções para trocá-las).',
  'tui.faq.why_docker_q': 'Por que ele roda dentro do Docker?',
  'tui.faq.why_docker_a':
    'Isolamento + um teto de memória no kernel: os agentes têm acesso ao shell e mexem no sistema de arquivos, e o limite --memory do container garante que a máquina nunca trave. O huu é docker-only — o wrapper reexecuta o binário dentro do container automaticamente (não existe modo nativo).',
  'tui.faq.ports_q': 'Como os agentes paralelos evitam conflito de portas?',
  'tui.faq.ports_a':
    'Um shim nativo (LD_PRELOAD / DYLD_INSERT_LIBRARIES) intercepta bind() e aloca uma porta livre por agente, injetada via .env.huu.',
  'tui.faq.assistant_q': 'O que é o Assistente de Pipeline [A]?',
  'tui.faq.assistant_a':
    'Modo guiado por LLM: você descreve o objetivo em linguagem natural e o assistente propõe um pipeline pronto para editar e rodar.',
  'tui.faq.prior_runs_q': 'Dá para ver execuções anteriores?',
  'tui.faq.prior_runs_a':
    'Sim. Pipelines salvos em ./pipelines aparecem na tela inicial. Use [M] para abrir o gerenciador de pipelines salvos.',

  'tui.summary.failed': 'A execução falhou',
  'tui.summary.finished': 'Execução concluída',
  'tui.summary.finished_with_failures_one': 'Execução concluída — {count} agente falhou',
  'tui.summary.finished_with_failures_other': 'Execução concluída — {count} agentes falharam',
  'tui.summary.first_failure': '⚠ primeira falha ({kind}): {message}',
  'tui.summary.kind_failed': 'falhou',
  'tui.summary.unknown': 'desconhecido',
  'tui.summary.logs_hint':
    'logs completos dos agentes: logs de execução em .huu/ · detalhes por card no painel (ENTER num card)',
  'tui.summary.run_id': 'runId:',
  'tui.summary.integration_branch': 'branch de integração:',
  'tui.summary.duration': 'duração:',
  'tui.summary.agents_committed': 'agentes commitados:',
  'tui.summary.files_modified': 'arquivos alterados:',
  'tui.summary.conflicts': 'conflitos:',
  'tui.summary.hint_back': 'voltar ao editor de pipeline',
} as const;
