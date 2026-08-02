# Playbook de técnicas de prompting — cross-LLM, aplicado aos prompts de step do huu

> Técnicas testadas em campo para escrever os prompts por step que conduzem
> os agentes do huu, destiladas para sobreviver entre provedores e modelos
> **pequenos**.
>
> English: [prompting-playbook.md](prompting-playbook.md) ·
> Knowledge skill: [`.agents/skills/authoring-agent-prompts/SKILL.md`](../.agents/skills/authoring-agent-prompts/SKILL.md) ·
> Referência de schema: [pipeline-json-guide.md](pipeline-json-guide.md)

O huu roda agentes LLM em git worktrees isolados através de pipelines
determinísticos. Cada step é **uma operação cognitiva**; o humano
fundamenta o método e o agente fornece a inteligência. Esse contrato só se
sustenta se o prompt do step for preciso o bastante para um modelo
*pequeno* executá-lo mecanicamente — em qualquer um dos 15+ provedores do pi
que estiver conectado.

Este playbook é a camada de engenharia de prompt desse contrato. Todo
pipeline default empacotado (`src/lib/default-pipelines/`) já o aplica;
leia-o antes de escrever ou afiar qualquer prompt de step, condição de juiz
ou prompt de recon de memória.

## Técnicas

**1. Decomposição em diretivas atômicas.** Expresse cada step como uma única
operação cognitiva quebrada em subpassos numerados e dirigidos por verbo;
substitua verbos vagos (*melhore*, *considere*, *trate*) por verbos
mecânicos (*leia*, *parseie*, *escreva*, *asserte*).
*Por que cross-LLM:* modelos pequenos/fracos não inferem intenção — executam
verbos literais, e uma única operação mantém a instrução inteira dentro da
atenção de trabalho deles.
*No huu:* um step = um artefato `produces` ou uma transformação; um step de
fan-out por arquivo faz a MESMA operação única em cada `$file`, nunca uma
checklist.

**2. Tags estruturais / seccionamento.** Separe instrução de dados com zonas
visíveis — banners `=== STEP n ===` ou blocos no estilo XML `<task>` /
`<context>` / `<output>`.
*Por que cross-LLM:* delimitadores são o sinal mais portável entre provedores
para "isto é comando, aquilo é payload"; modelos pequenos, sem eles, misturam
os dois.
*No huu:* cerque o conteúdo injetado de `$file` e a nota `$hint` dentro do seu
próprio bloco com tag, para que o modelo nunca trate dados escaneados como
ordens.

**3. Contrato de saída explícito.** Declare o schema exato — nomes de campos,
tipos, enums — ANTES do corpo da tarefa, não depois.
*Por que cross-LLM:* todo provedor honra um schema declarado de antemão muito
melhor que um inferido da prosa; é o movimento de confiabilidade de maior
alavancagem.
*No huu:* o MEMORY CONTRACT do `produces` (path + formato `huu-memory-v1` + o
cap do consumidor + a regra de hint) é anexado automaticamente por
`src/lib/memory-contract.ts`, e o schema de append do FAQ das auditorias
(`<topic>-faq.json`) é declarado do mesmo jeito — declare o link, nunca cole
boilerplate.

**4. Abertura com papel + o que está em jogo.** Comece com "You are X. Goal:
Y." — um papel concreto mais o único resultado que importa.
*Por que cross-LLM:* um papel prepara de forma barata a região de retrieval
certa; declarar o que está em jogo impede o modelo de otimizar para a coisa
errada.
*No huu:* "You are a security auditor. Goal: write `.huu/audits/<topic>.md`,
report-only" orienta o agente e reafirma o contrato report-only em uma linha.

**5. Ancoragem por few-shot.** Dê 2-3 exemplos curados — um canônico, um caso
de borda — mantidos curtos.
*Por que cross-LLM:* um exemplo resolvido fixa formato e granularidade com mais
confiabilidade que qualquer quantidade de descrição, e transfere entre
famílias de modelos.
*No huu:* mostre uma entrada `huu-memory-v1` bem-formada e uma complicada (um
path sem hint, um arquivo a pular) para que o step de recon emita exatamente o
formato sobre o qual o consumidor faz fan-out.

**6. Restrições negativas com parcimônia.** Use poucas HARD RULES, não um muro
de proibições, e emparelhe cada "não faça" com a alternativa positiva.
*Por que cross-LLM:* listas longas de negação degradam modelos pequenos (eles
se prendem ao token proibido); um redirecionamento positivo é o que eles
conseguem executar.
*No huu:* "Do NOT touch `README.md`/`package.json`; write ONLY under
`.huu/audits/`" — a superfície report-only como uma proibição mais seu alvo
permitido.

**7. Chain-of-thought APENAS em juízes/decisões.** Peça raciocínio passo a
passo nos juízes CheckStep e em decisões de roteamento — não em steps de
código, onde o diff É o raciocínio.
*Por que cross-LLM:* CoT eleva a acurácia de decisão ([Wei et al. 2022](https://arxiv.org/abs/2201.11903))
mas incha e desestabiliza steps de transformação determinísticos e desperdiça
tokens em modelos pequenos.
*No huu:* um juiz pode raciocinar antes do seu JSON de veredito; um step de fix
por arquivo apenas edita e commita — o diff do worktree é a trilha de
auditoria, nenhuma narração é pedida.

**8. Auto-verificação / self-check.** Termine o prompt com um bloco
"SELF-CHECK before finishing" listando os invariantes a confirmar.
*Por que cross-LLM:* um modelo relendo sua própria saída contra uma checklist
explícita pega as próprias violações — um portão de qualidade barato e
agnóstico de provedor.
*No huu:* "SELF-CHECK: arquivo escrito no path exato de `filesFrom`? toda
entrada tem hint? `_format` é `huu-memory-v1`?" — antecipa a falha de run por
arquivo corrompido antes que o próximo estágio o leia.

**9. Injeção de variáveis.** Parametrize com `$file`, `$hint`, `$runs`; nunca
fixe um path ou um nome de arquivo no prompt.
*Por que cross-LLM:* desacoplar o prompt dos dados permite que um template de
prompt rode em paralelo sobre N tarefas e siga reutilizável quando o conjunto
de arquivos muda.
*No huu:* `$hint` (substituído antes de `$file`) carrega a pista por arquivo do
produtor até o consumidor; `$runs` deixa uma condição de juiz ver a contagem de
visitas para os caps de loop.

**10. Disclosure progressivo / system prompt enxuto.** Mantenha o
system/preâmbulo minúsculo; coloque a lógica da tarefa no prompt do step.
*Por que cross-LLM:* o pi mantém seu system prompt abaixo de ~1k tokens e
carrega instruções do projeto (AGENTS.md / skills sob demanda) só quando
necessário — um preâmbulo inchado expulsa a tarefa real em janelas de contexto
pequenas.
*No huu:* o prompt do step é a unidade de trabalho; não reafirme arquitetura ou
docs de ferramentas que o agente já carrega — diga O QUE produzir e COMO é
verificado.

**11. Juízes mecânicos (vereditos de enum fixo).** Um juiz emite
`{ "label": "...", "reason": "..." }` a partir de um conjunto pequeno e fixo
de labels; nenhum raciocínio multi-hop, e o **outcome default precisa mover o
pipeline PARA FRENTE** (stub-safe).
*Por que cross-LLM:* um enum minúsculo é parseável por qualquer modelo e degrada
com segurança; o default para frente faz com que um juiz fraco/stubado nunca
trave o run.
*No huu:* `outcomes[]` carrega exatamente um `default: true` — torne-o o caminho
SEGURO (geralmente `approved`/`proceed`), nunca o loop, porque ele dispara em
falha do juiz, label desconhecido, ou o cap de `maxRuns`.

**12. Iteração empírica.** Faça A/B de um prompt de step contra alguns
arquivos representativos; trate descrições e prompts como o sinal de
roteamento e afie-os a partir das falhas observadas.
*Por que cross-LLM:* modelos diferem — a única verdade de campo é o
comportamento no seu repositório; texto de prompt é ajustado, não adivinhado.
*No huu:* faça dry-run com o backend stub (grátis, sem chave), observe qual
outcome de juiz de fato dispara no kanban, e então aperte o texto de onde a
falha veio.

## Notas sobre o PI coding agent

O backend default é o **pi** (pi.dev / `@mariozechner/pi-coding-agent`) sobre
o OpenRouter. Escreva prompts de step alinhados ao seu grão:

- **Ele carrega instruções do projeto sozinho.** O pi lê `AGENTS.md` /
  `SYSTEM.md` e puxa skills sob demanda — não recole arquitetura,
  convenções ou layout do repo dentro de um prompt de step.
- **As ferramentas são UNIX puro.** read / bash / edit / write / grep. O
  agente já sabe usá-las, então prompts não precisam documentar APIs de
  ferramentas nem ensinar a CLI — declare a tarefa e os critérios de
  aceitação, pule o tutorial de ferramentas.
- **O modelo é plugável (15+ provedores).** Mantenha prompts
  agnósticos de provedor: confie em schema + delimitadores + exemplos, não nas
  manias ou recursos ocultos de um modelo específico.
- **Assuma competência, especifique o resultado.** O formato confiável é
  *tarefa + aceitação*, não *teclas passo a passo* — diga O QUE precisa ser
  verdade quando terminar, deixe-o escolher os comandos.

Veja [pi-coding-agent.md](pi-coding-agent.md) para como o huu instancia e
controla sessões do pi.

## Anti-padrões

- **Steps multi-operação** — um prompt que escaneia E corrige E documenta;
  quebre em steps atômicos (técnica 1).
- **"responda em JSON" sem restrição** sem schema de campo/tipo/enum — a saída
  deriva e o parser do próximo estágio falha (técnica 3).
- **Aceitação vaga** — "write good tests", "make it better"; nada é
  verificável, então nenhum juiz consegue gatear (técnicas 1, 11).
- **System prompt entupido** — reafirmar docs de ferramentas e arquitetura que
  o agente já carrega, expulsando a tarefa (técnica 10).
- **Sobrecarga de negação** — um muro de "não faça" sem alternativa positiva
  que modelos pequenos consigam executar (técnica 6).
- **Papel sem o que está em jogo** — "You are an expert engineer." sem meta; o
  papel não prepara nada útil (técnica 4).
- **Misturar descoberta + transformação** em um step — deixe um step anterior
  ESCREVER o arquivo de memória e o step de memória CONSUMI-LO; não faça um
  step ao mesmo tempo achar e corrigir (técnicas 1, 9).
- **Paths de arquivo fixos** num prompt de fan-out — quebra a reutilização
  paralela; injete `$file`/`$hint` no lugar (técnica 9).
- **Juízes fazendo raciocínio pesado** — um CheckStep que re-audita o repo
  inteiro em vez de checar uma condição declarada e objetiva; mantenha o
  veredito mecânico e o default para frente (técnica 11).

## Fontes

- [Anthropic — Prompt engineering overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview) — papel, exemplos, estrutura, instruções explícitas.
- [OpenAI — GPT-4.1 prompting guide](https://developers.openai.com/cookbook/examples/gpt4-1_prompting_guide) — seguir instruções, delimitadores, prompting agêntico.
- [OpenAI — Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) — schema-first, confiabilidade de saída com enum fixo.
- [Google — Gemini prompting strategies](https://ai.google.dev/gemini-api/docs/prompting-strategies) — enquadramento de tarefa, few-shot, restrições.
- [Wei et al. 2022 — Chain-of-Thought prompting](https://arxiv.org/abs/2201.11903) — raciocínio para decisões/juízes, não transformações.
- [pi coding agent — notas de design](https://mariozechner.at/posts/2025-11-30-pi-coding-agent/) e [pi.dev](https://pi.dev/) — system prompt enxuto, ferramentas UNIX puras, modelos plugáveis.
