/** UI do navegador. Gêmeo de `en/web.ts` — servido por `GET /api/i18n`. */

export const webPtBR = {
  'web.common.add': 'Adicionar',
  'web.common.auto': 'Auto',
  'web.common.back': '← Voltar',
  'web.common.clear_all': 'Limpar tudo',
  'web.common.close': 'Fechar',
  'web.common.default': 'padrão',
  'web.common.delete': 'Excluir',
  'web.common.loading': 'Carregando…',
  'web.common.manual': 'Manual',
  'web.common.min': 'min',
  'web.common.na': 'n/d',
  'web.common.no': 'não',
  'web.common.remove': 'Remover',
  'web.common.yes': 'sim',

  'web.boot.failed': 'Falha ao carregar o huu: {message}',

  'web.top.stage': 'Estágio',
  'web.top.stage_title': 'Estágio / onda do pipeline',
  'web.top.tasks': 'Tarefas',
  'web.top.tasks_title': 'Tarefas concluídas / total',
  'web.top.elapsed': 'Decorrido',
  'web.top.elapsed_title': 'Tempo decorrido',
  'web.top.cost': 'Custo',
  'web.top.cost_title': 'Custo estimado (USD)',
  'web.top.fewer_agents': 'Menos agentes',
  'web.top.more_agents': 'Mais agentes',
  'web.top.conc_mode':
    'Modo de concorrência — clique para alternar Auto · Manual (a vazão da máquina fica no ⚙ orçamento de RAM)',
  'web.top.auto': 'auto',
  'web.top.pause': 'Pausar',
  'web.top.pause_title': 'Pausar / retomar a simulação',
  'web.top.resume': 'Retomar',
  'web.top.finish': 'Encerrar',
  'web.top.finish_title': 'Encerrar a execução — para de esperar retentativas',
  'web.top.stop': 'Parar',
  'web.top.stop_queue': 'Parar a fila',
  'web.top.stop_queue_title': 'Parar a fila inteira',
  'web.top.theme': 'Alternar tema',


  'web.launch.title': 'Rodar um pipeline',
  'web.launch.subtitle':
    'Processos determinísticos sobre agentes que pensam — escolha um, escolha um modelo, vai.',
  'web.launch.queue_running': 'Fila rodando',
  'web.launch.view_board': 'Ver o quadro →',
  'web.launch.steps_aria': 'Passos do lançamento',
  'web.launch.pick_pipeline': 'Escolha um pipeline',
  'web.launch.mark_folders': 'Marque as pastas de projeto',
  'web.launch.mark_hint':
    'Navegue pelo sistema de arquivos e marque todo projeto onde este pipeline deve rodar — cada pasta marcada vira uma execução própria. As marcas persistem enquanto você navega.',
  'web.launch.no_pipelines': 'Nenhum pipeline encontrado em',

  'web.step.pipeline': 'Pipeline',
  'web.step.projects': 'Projetos',
  'web.step.config': 'Config',
  'web.step.queue': 'Fila',

  'web.folder.home': '⌂ Início',
  'web.folder.home_title':
    'Ir para a raiz do workspace (HUU_WORKSPACE, por padrão sua pasta pessoal)',
  'web.folder.parent': '↑ Acima',
  'web.folder.mark_all': '☑ Marcar todas',
  'web.folder.mark_all_n': '☑ Marcar todas ({count})',
  'web.folder.unmark_all_n': '☐ Desmarcar todas ({count})',
  'web.folder.mark_all_title':
    'Marca toda subpasta listada aqui como projeto (quando todas estão marcadas, desmarca)',
  'web.folder.mark_all_title_n': 'Marcar as {count} subpastas listadas aqui como projetos',
  'web.folder.unmark_all_title':
    'Todas as subpastas aqui estão marcadas — clique para desmarcar todas',
  'web.folder.use_prefix': 'Usar',
  'web.folder.use_suffix': 'selecionadas →',
  'web.folder.no_subdirs': 'Sem subdiretórios',
  'web.folder.mark': 'Marcar como projeto',
  'web.folder.unmark': 'Desmarcar projeto',
  'web.folder.is_git': '✓ git',
  'web.folder.not_git': '⚠ sem git',
  'web.folder.this_folder': 'esta pasta',

  'web.config.title': 'Configure este pipeline',
  'web.config.pipeline': 'Pipeline',
  'web.config.projects': 'Projetos',
  'web.config.provider': 'Provedor',
  'web.config.model': 'Modelo',
  'web.config.model_placeholder': 'Carregando modelos…',
  'web.config.resolver_model': 'Modelo resolvedor de conflitos',
  'web.config.resolver_placeholder': 'Igual ao modelo da execução',
  'web.config.resolver_placeholder_value': 'Igual ao modelo da execução',
  'web.config.resolver_hint':
    'Usado só para resolver conflitos de merge durante a integração · roda no máximo de raciocínio · vazio = igual ao modelo da execução',
  'web.config.concurrency': 'Concorrência',
  'web.config.timeout': 'Tempo máximo por agente',
  'web.config.timeout_hint':
    'Limite de tempo de cada agente, aplicado ao pipeline inteiro. Vazio = o padrão global das Configurações (⚙), ou o padrão do pipeline se aquele também estiver vazio.',
  'web.config.add_to_queue': 'Adicionar à fila',
  'web.config.add_hint':
    'Este pipeline roda em todos os projetos que você marcou — adicione mais pipelines em seguida, ou rode a fila.',

  'web.queue.title': 'Fila',
  'web.queue.empty': 'A fila está vazia — adicione um pipeline para começar.',
  'web.queue.add_another': 'Adicionar outro pipeline',
  'web.queue.add_start': 'Adicionar e iniciar',
  'web.queue.run': 'Rodar a fila',
  'web.queue.run_n': 'Rodar a fila ({count})',
  'web.queue.running_label': 'Rodando…',
  'web.queue.default_model': 'modelo padrão',
  'web.queue.err_pick_first': 'Escolha um pipeline e marque pelo menos um projeto',
  'web.queue.added_starting': '{count} adicionados — começando agora',
  'web.queue.added_one': '{count} projeto adicionado à fila',
  'web.queue.added_other': '{count} projetos adicionados à fila',
  'web.queue.project_count_one': '{count} projeto',
  'web.queue.project_count_other': '{count} projetos',
  'web.queue.remove_pipeline': 'Remover pipeline',
  'web.queue.key_needed': 'falta a chave',
  'web.queue.run_word': 'execução',
  'web.queue.run_failed': '{name} falhou: {reason}',
  'web.queue.see_board': 'veja o quadro ou o log do terminal do huu',
  'web.queue.finished_ok': 'Fila concluída ✓ · salva no Histórico',
  'web.queue.finished_errors': 'Fila concluída — {count} falharam · salva no Histórico',
  'web.queue.stopped': 'Fila parada',
  'web.queue.stopping': 'Parando a fila…',

  'web.qstatus.queued': 'na fila',
  'web.qstatus.running': 'rodando',
  'web.qstatus.done': 'concluído',
  'web.qstatus.failed': 'falhou',

  'web.status.idle': 'ocioso',
  'web.status.queued': 'na fila',
  'web.status.running': 'rodando',
  'web.status.done': 'concluído',
  'web.status.error': 'erro',
  'web.status.review': 'revisão',
  'web.status.paused_ram': 'pausado (RAM)',

  'web.lane.todo': 'A fazer',
  'web.lane.doing': 'Em andamento',
  'web.lane.done': 'Concluído',

  'web.run.spinning_up': 'Subindo os agentes…',
  'web.run.preparing': 'Preparando as worktrees…',
  'web.run.wave': 'onda {n}',
  'web.run.failed_label': 'Falhou:',
  'web.run.done_label': 'Pronto.',
  'web.run.pipeline_finished': 'O pipeline “{name}” terminou.',
  'web.run.switch_projects': 'Alternar entre os projetos em execução',
  'web.run.new_run': '← Nova execução',
  'web.run.run_again': '↻ Rodar de novo',
  'web.run.stopping': 'Parando a execução…',

  'web.log.title': 'Log da execução',
  'web.log.running': 'rodando',
  'web.log.projects': '{count} projetos',
  'web.log.queued': '{count} na fila',
  'web.log.lines': '{count} linhas',
  'web.log.filter_aria': 'Filtrar o log por nível',
  'web.log.all': 'Tudo',
  'web.log.warn_only': 'Só avisos',
  'web.log.error_only': 'Só erros',
  'web.log.jump': '↓ Mais recente',
  'web.log.waiting_first': 'Aguardando a primeira linha de log…',
  'web.log.empty': 'Nenhuma entrada de log ainda.',

  'web.card.task': 'Tarefa {id}',
  'web.card.merge': 'Merge',
  'web.card.judge': 'Juiz',
  'web.card.merged_n': '{count} mesclados',
  'web.card.conflicts_n': '{count} conflito',
  'web.card.resolver': 'resolvedor',
  'web.card.default': 'padrão',
  'web.card.next': 'próximo: {name}',
  'web.card.retry_n': 'retentativa {count}',
  'web.card.review_waived_title':
    'revisão dispensada no teto de rodadas — sobraram achados bloqueantes',

  'web.phase.agent': 'agente',
  'web.phase.merge': 'merge',
  'web.phase.judge': 'juiz',
  'web.phase.timeout': 'timeout',
  'web.phase.failed': 'falhou',
  'web.phase.paused': 'pausado',
  'web.phase.no_changes': 'sem mudanças',
  'web.phase.unmerged': 'não mesclado',
  'web.phase.ready': 'pronto',
  'web.phase.requeued': 'reenfileirado',
  'web.phase.queued': 'na fila',
  'web.phase.review': 'revisão',
  'web.phase.fixing': 'corrigindo',

  'web.kv.phase': 'Fase',
  'web.kv.stage': 'Estágio',
  'web.kv.tokens_in': 'Tokens de entrada',
  'web.kv.tokens_out': 'Tokens de saída',
  'web.kv.cost': 'Custo',
  'web.kv.requeues': 'Reenfileiramentos',
  'web.kv.review_rounds': 'Rodadas de revisão',
  'web.kv.review': 'Revisão',
  'web.kv.review_waived': 'dispensada no teto de rodadas',
  'web.kv.branch': 'Branch',
  'web.kv.files': 'Arquivos',
  'web.kv.commit': 'Commit',
  'web.kv.error': 'Erro',
  'web.kv.runs': 'Execuções',
  'web.kv.run': 'Execução',
  'web.kv.merged': 'Mesclados',
  'web.kv.pending': 'Pendentes',
  'web.kv.resolver': 'Resolvedor',
  'web.kv.used': 'usado',
  'web.kv.conflicts': 'Conflitos',
  'web.kv.model': 'Modelo',
  'web.kv.outcome': 'Resultado',
  'web.kv.next': 'Próximo',
  'web.kv.from_judge': 'Veio do juiz',

  'web.drawer.logs': 'Logs',
  'web.drawer.condition': 'Condição:',

  'web.retry.timed_out': 'Deu timeout — rode de novo com um novo limite, ou como está.',
  'web.retry.failed': 'Falhou — rode esta tarefa de novo.',
  'web.retry.new_timeout': 'Novo timeout (min)',
  'web.retry.go': 'Repetir a tarefa',
  'web.retry.go_timeout': 'Repetir com o novo timeout',
  'web.retry.toast': 'Repetindo a tarefa #{id}…',
  'web.retry.finishing': 'Encerrando a execução…',

  'web.budget.tip_head':
    'O huu pode usar até {percent}% da RAM ({gib} GiB) somando todas as execuções.',
  'web.budget.tip_used': 'Usados {used} de {total} GiB · PSI some {psi}',
  'web.budget.container_scope': 'escopo do container {scope}G de host {host}G',
  'web.budget.host_avail': '{avail}G livres',
  'web.budget.guard': 'guarda: {reason}',
  'web.budget.agents_live': 'agentes vivos {live} do orçamento B {budget}',
  'web.budget.reserved': '{count} juiz/merge',
  'web.budget.footprint': 'pegada/agente ≈ {mib} MiB',
  'web.budget.chip_host': 'host {used}/{total}G',
  'web.budget.chip_agents': 'agentes {live}/{budget}',
  'web.budget.chip_ram': 'RAM {percent}%',
  'web.budget.chip_huu': 'huu {used}/{total}G',
  'web.budget.host_limited': 'limitado pelo host',
  'web.pressure.over_budget': 'acima do orçamento',
  'web.pressure.pressure': 'pressão',
  'web.pressure.thrash': 'thrashing',

  'web.combo.inherit_hint': 'herdar o modelo da execução para resolver conflitos',
  'web.combo.use_custom': 'Usar “{id}”',
  'web.combo.custom_id': 'id personalizado',
  'web.combo.custom_model_id': 'id de modelo personalizado',
  'web.combo.as_is': 'enviado ao OpenRouter como está',
  'web.combo.reasoning': 'raciocínio',
  'web.combo.thinking': 'pensa',
  'web.combo.no_tools': 'sem ferramentas',
  'web.combo.search_placeholder': 'Busque ou digite qualquer id de modelo…',
  'web.combo.type_placeholder': 'Digite um id de modelo…',
  'web.combo.available_one': '{count} modelo disponível',
  'web.combo.available_other': '{count} modelos disponíveis',
  'web.combo.models_count': '{count} modelos',
  'web.combo.full_catalog': 'catálogo completo do OpenRouter · ou digite qualquer id de modelo',
  'web.combo.catalog_offline':
    'Não deu para falar com o OpenRouter — mostrando os modelos recomendados; digite qualquer id para usá-lo mesmo assim',

  'web.key.paste_value': 'cole o valor…',
  'web.key.validate_use': 'Validar e usar',
  'web.key.expected_prefix': 'Esperado começar com “{prefix}”.',
  'web.key.set': '✓ {label} definida',
  'web.key.needed': 'falta {label}',
  'web.key.change': 'trocar',
  'web.key.session_only':
    'Validada contra o provedor e mantida só nesta aba do navegador — nunca gravada em disco.',
  'web.key.validated_session': 'Chave validada ✓ — mantida só neste navegador',
  'web.key.rejected': 'Chave rejeitada (HTTP {status}). Confira e cole de novo.',
  'web.key.wrong_provider':
    'Isso é uma chave do {label} — nada foi salvo. Escolha {label} como provedor, ou cole a chave certa.',
  'web.key.unverified':
    'Não deu para verificar o valor ({reason}) — usando nesta sessão mesmo assim.',

  'web.history.title': 'Histórico de execuções',
  'web.history.export': 'Exportar JSON',
  'web.history.none': 'Nenhuma execução ainda',
  'web.history.empty': 'Nenhuma execução ainda. Rode uma fila para construir o histórico.',
  'web.history.unavailable': 'Histórico indisponível: {message}',
  'web.history.meta_one': '{count} execução · ${total} no total',
  'web.history.meta_other': '{count} execuções · ${total} no total',
  'web.history.cards': '{count} cards',
  'web.history.unmerged': 'não mesclado',
  'web.history.col_kind': 'Tipo',
  'web.history.col_card': 'Card',
  'web.history.col_phase': 'Fase',
  'web.history.col_tokens': 'Tokens',
  'web.history.col_cost': 'Custo',
  'web.history.no_cards': 'Nenhum card registrado nesta execução.',
  'web.history.total_prefix': 'Total do projeto',
  'web.history.card_sum': 'soma dos custos dos cards ${sum}',
  'web.history.nothing_export': 'Nada para exportar',
  'web.history.exported_one': '{count} execução exportada',
  'web.history.exported_other': '{count} execuções exportadas',
  'web.history.confirm_clear': 'Limpar todo o histórico? Isso não tem volta.',

  'web.settings.title': 'Configurações',
  'web.settings.aria': 'Configurações da UI web',
  'web.settings.language': 'Idioma',
  'web.settings.language_hint':
    'Vale só para este navegador. A UI de terminal segue a HUU_LANG.',
  'web.settings.language_changed': 'Idioma alterado',
  'web.settings.timeout_hint':
    'Padrão para toda execução iniciada por este navegador, aplicado ao pipeline inteiro. Vazio = o padrão do pipeline (10 min · 5 min para tarefas de arquivo único). Um valor por projeto sobrepõe este. Só na UI web — o CLI mantém as próprias regras.',
  'web.settings.timeout_global': '{minutes} (global)',
  'web.settings.ram': 'Orçamento de RAM',
  'web.settings.ram_hint':
    'Fatia da RAM total que o huu pode usar somando TODAS as execuções simultâneas desta máquina (10–95). Aplicada IMEDIATAMENTE às execuções em andamento e na fila, persistida no servidor e imposta pela guarda de pressão (o chip da barra mostra o valor vivo). Maior = mais paralelismo, margem de segurança menor; o resto fica reservado ao sistema. Vazio = 70%.',
  'web.settings.ram_applied': 'Orçamento de RAM: {percent}% — aplicado a todas as execuções agora',
  'web.settings.keys': 'Chaves de API do provedor',
  'web.settings.checking': 'Verificando…',
  'web.settings.validate_add': 'Validar e adicionar',
  'web.settings.validating': 'Validando…',
  'web.settings.keys_hint':
    'Verificada primeiro contra o provedor selecionado — uma chave rejeitada, ou que pertence a outro provedor, nunca é salva. Uma chave válida entra no pool e é usada por toda execução nova (nesta sessão e nos próximos huu); esta aba passa a usá-la imediatamente. Com mais de uma chave o huu alterna por tentativa, pulando as queimadas e as em espera. Os resultados da validação e qualquer problema de execução também vão para o terminal onde o huu roda.',
  'web.settings.in_use': 'em uso',
  'web.settings.remove_key': 'Remover esta chave do pool',
  'web.settings.pool_count_one':
    '{count} chave no pool · o huu alterna por tentativa, pulando as queimadas e as em espera.',
  'web.settings.pool_count_other':
    '{count} chaves no pool · o huu alterna por tentativa, pulando as queimadas e as em espera.',
  'web.settings.pool_reset': 'zerar queimadas / esperas',
  'web.settings.pool_reset_done': 'Chaves queimadas e esperas zeradas',
  'web.settings.no_key': 'Ainda não há chave do {label} — cole uma abaixo.',
  'web.settings.active_key': '✓ Ativa: {masked} — {source}',
  'web.settings.clear_saved': 'apagar a chave salva',
  'web.settings.env_ignored':
    '⚠ {envVar} está definida no ambiente mas é IGNORADA — a chave acima ganha. Apague a chave salva para voltar a ela.',
  'web.settings.session_key':
    'Esta aba tem uma chave de sessão validada e a envia com as execuções lançadas aqui.',
  'web.settings.status_unavailable': 'Status da chave indisponível: {message}',
  'web.settings.paste_first': 'Cole uma chave do {label} primeiro.',
  'web.settings.key_wrong_provider':
    'Isso é uma chave do {label}, não do {expected} — nada foi salvo.',
  'web.settings.key_rejected':
    'O {label} rejeitou esta chave (HTTP {status}) — nada foi salvo. Confira e cole de novo.',
  'web.settings.key_saved': 'Chave validada ✓ e salva — toda execução nova vai usá-la',
  'web.settings.key_unverified':
    'Não deu para falar com o {label} para verificar ({reason}) — a chave foi salva mesmo assim; as execuções vão tentar.',
  'web.settings.key_removed': 'Chave removida do pool',
  'web.settings.key_cleared': 'Chave salva apagada',
  'web.settings.key_cleared_note': 'Chave salva apagada — {note}',

  'web.keysrc.options': 'salva por esta tela de Opções (ativa agora)',
  'web.keysrc.stored': 'chave salva (config store)',
  'web.keysrc.secret_mount': 'repassada pelo host quando o huu subiu',
  'web.keysrc.env_file': 'arquivo indicado pela variável _FILE',
  'web.keysrc.env': 'variável de ambiente',

  'web.sim.title': 'Simulação',
  'web.sim.subtitle':
    'Veja o kanban, os agentes e os logs ao vivo do começo ao fim — totalmente sintético: sem branches, sem chave de API, sem custo. Escolha seus modelos, quantos arquivos e quantos agentes rodam ao mesmo tempo.',
  'web.sim.configure': 'Configure a simulação',
  'web.sim.models': 'Modelos',
  'web.sim.model_placeholder': 'ex.: deepseek/deepseek-chat — digite e Adicione',
  'web.sim.files': 'Número de arquivos',
  'web.sim.agents': 'Agentes simultâneos',
  'web.sim.start': 'Iniciar a simulação',
  'web.sim.hint':
    'Cada execução sorteia a mistura completa de cenários — streaming, reenfileiramentos da guarda de memória (↻), retentativas, merges de estágio e o laço de retrabalho do juiz.',
  'web.sim.back': '← Voltar ao huu',

  // Os checkboxes de metodologia. Chaveados pelo campo de `DevMethodology`
  // para o navegador renderizar o texto do CATÁLOGO, não o inglês cru que o
  // servidor serve a partir de `methodology-registry.ts` — aquele registry
  // declara QUAIS opções existem; estas chaves declaram como elas se LEEM.
  // O efeito colateral está DENTRO da descrição de propósito. `--debate` é a
  // única opção que não acrescenta rubrica nem portão próprio, então o crítico
  // passar a SEGURAR é um comportamento que o usuário ganha sem pedir se não
  // estiver dito aqui.
  
  /* NÃO escondido, AVISADO. O driver carrega os dois como metadado da sessão e
     nenhum dos dois é compilado num desenho, então a interface honesta é o
     painel continuar ali com uma frase dizendo o que ele faz e o que não faz. */

  /* O painel de sessão, quando a sessão é um DESENHO. `drawnMethod` chega no
     primeiro frame; `graph` só depois que o desenho compila. */

  /* O portão de retomada, quando a sessão em disco era um DESENHO. */

  /* ---- O chat do debate adversarial (só com `--debate`) ---- */
  // TRÊS FATOS DIFERENTES, três frases diferentes. Eles colidiam: `silent` era
  // impresso tanto para um lado que CRASHOU quanto para uma rodada cuja
  // narração ao vivo simplesmente saiu da memória — e os dois liam como uma
  // escolha deliberada de não escrever. Só `silent` é uma afirmação sobre o
  // DEBATE (o servidor leu o arquivo e não havia nenhum); os outros dois são
  // afirmações sobre o agente e sobre a UI.



  /* ── O desenho do método (/graph) ──────────────────────────────────────────
     Só chrome. Toda REGRA que a tela enuncia — por que uma ligação foi
     recusada, o que um problema do validador significa — chega como FRASE
     pronta de `graph-model.js` ou do servidor e é mostrada literalmente, então
     essas mensagens não são chaves daqui. Uma tabela, uma voz: uma segunda
     cópia dos 45 códigos seria uma segunda autoridade no instante em que um
     dos lados fosse editado. */




  /* A vida do método: a biblioteca, o id no disco, a compilação. */

  /* Rodar o desenho. O canvas não inicia a sessão sozinho: ele entrega o método
     para o modo de desenvolvimento, que é dono do objetivo, do projeto e do
     roteamento de modelos. A outra ponta está em `web.dev.method_source_*`. */

  /* A pesquisa: o que ela devolve e o que cada resposta aciona. */

  /* Os braços e o comportamento cadastrado em cada um. */

  /* A ação: o que ela roda, sobre o quê, e em que largura. */

  'web.builder.back': 'Pipelines',
  'web.builder.title': 'Construtor de pipelines',
  'web.builder.ai_model_chip': 'MiMo V2.6 Pro',
  'web.builder.draft_heading': 'Rascunho',
  'web.builder.name_label': 'Nome',
  'web.builder.name_ph': 'ex.: Auditoria de segurança',
  'web.builder.desc_label': 'Descrição',
  'web.builder.desc_ph': 'uma frase sobre o que a pipeline faz',
  'web.builder.add_step': 'Adicionar passo',
  'web.builder.remove_step': 'Remover passo',
  'web.builder.remove_step_aria': 'Remover passo {n}',
  'web.builder.step_name_aria': 'Nome do passo {n}',
  'web.builder.step_name_ph': 'ex.: 1. Escrever testes',
  'web.builder.prompt_label': 'Prompt (o que o agente faz)',
  'web.builder.prompt_ph': 'imperativo, autossuficiente, nomeia entradas e saídas',
  'web.builder.scope_label': 'Escopo',
  'web.builder.scope_project': 'project (um agente)',
  'web.builder.scope_per_file': 'per-file (fan-out)',
  'web.builder.scope_flexible': 'flexible (o orquestrador decide)',
  'web.builder.scope_memory': 'memory (consome um arquivo de specs)',
  'web.builder.depends_label': 'Depende de',
  'web.builder.depends_ph': 'nomes de passos separados por vírgula; vazio = paralelo',
  'web.builder.json_show': 'Ver JSON',
  'web.builder.json_hide': 'Esconder JSON',
  'web.builder.save': 'Guardar pipeline',
  'web.builder.save_hint': 'Nome e pelo menos um passo são necessários para guardar.',
  'web.builder.saved': 'Guardada “{name}” — já aparece na galeria.',
  'web.builder.save_error': 'Não foi possível guardar:',
  'web.builder.save_needs_name': 'Dê um nome à pipeline e preencha pelo menos um passo.',
  'web.builder.unnamed': 'Pipeline sem nome',
  'web.builder.ai_heading': 'Editor com IA',
  'web.builder.ai_intro': 'Descreva o que quer em linguagem natural. O editor pergunta quando algo está em aberto e devolve a pipeline completa — nada é aplicado sem você confirmar.',
  'web.builder.ai_input_ph': 'ex.: uma pipeline que audite segurança e escreva testes',
  'web.builder.ai_send': 'Enviar',
  'web.builder.ai_empty': 'Os seus pedidos e as respostas do editor aparecem aqui. Comece pelo que a pipeline deve FAZER — o editor traduz intenção em passos e pergunta quando uma escolha importa.',
  'web.builder.ai_error': 'O editor não conseguiu responder:',
  'web.builder.applied': 'Aplicado ao rascunho.',
  'web.builder.free_text_ph': 'Escreva a sua resposta…',
  'web.builder.free_text_send': 'Responder',
  'web.builder.apply_summary': 'Pipeline “{name}” · {n} passo(s).',
  'web.builder.apply_use': 'Aplicar ao rascunho',
  'web.builder.apply_dismiss': 'Descartar',
  'web.builder.gallery_card_title': 'Construir uma pipeline',
  'web.builder.gallery_card_desc': 'Abra o modo construção: edite à mão ou diga ao editor de IA o que quer.',
  'web.launch.search_ph': 'Filtrar pipelines…',
  'web.launch.search_aria': 'Filtrar pipelines',
  'web.launch.count_label': '{n} pipelines',
  'web.launch.count_filtered': '{n} de {total}',
  'web.launch.no_search_results': 'Nenhuma pipeline corresponde a este filtro.',
  'web.launch.card_meta': '{work} work · {check} check · {steps} steps',
  'web.launch.default_badge': 'padrão',
  'web.launch.step_locked': 'Conclua os passos anteriores primeiro.',
  'web.launch.add_hint': 'Escolha uma pipeline primeiro para a adicionar à fila.',
} as const;
