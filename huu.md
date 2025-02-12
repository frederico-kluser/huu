# huu

## Categoria 1: Interação com Elementos HTML (MVP)
Blocos para manipulação direta de elementos na página.

### BlockSelectHTMLElement (MVP)

- Função: Permite selecionar um elemento HTML na tela e armazená-lo em uma variável.
- Justificativa: Fundamental para identificar elementos (ex: botões, campos de texto). Pode usar seleção por CSS selector, XPath ou interação visual (como o "clicar para selecionar" do Puppeteer).

### BlockWaitForElement (MVP/Opcional)

- Função: Aguarda até que um elemento específico esteja presente no DOM.
- Justificativa: Essencial para páginas dinâmicas onde os elementos podem demorar a carregar.
- Observação: Pode ser considerado MVP se o foco inicial for em sites com carregamento assíncrono; caso contrário, pode ser adicionado depois.

### BlockScrollToElement (Posterior)

- Função: Rola a página até que o elemento selecionado esteja visível.
- Justificativa: Garante que o elemento esteja na viewport antes de interações (como cliques ou digitação).

## 2. Ações de Interação com Elementos

### BlockClickAction (MVP)

- Função: Executa um clique sobre o elemento selecionado.
- Justificativa: Ação básica para simular interações de usuário.

### BlockTypeAction (MVP)

- Função: Permite inserir texto em um elemento (por exemplo, um campo de input), podendo incluir um clique opcional para focar o campo.
- Justificativa: Essencial para preencher formulários ou simular digitação.

### BlockGetTextAction (MVP)

- Função: Extrai o texto interno (innerText) de um elemento selecionado.
- Justificativa: Útil para coletar informações exibidas na página e processá-las com a IA.

### BlockHoverAction (Posterior)

- Função: Simula o movimento do mouse sobre um elemento.
- Justificativa: Em alguns sites, o hover ativa menus ou informações extras; pode ser incorporado em versões futuras.

### BlockDoubleClickAction (Posterior)

- Função: Realiza um clique duplo em um elemento.
- Justificativa: Necessário em casos onde o clique duplo é a ação esperada (ex.: seleção de texto ou edição).

## 3. Navegação e Controle de Página
BlockNavigateToUrl (MVP)
Função: Abre uma URL específica no navegador.
Justificativa: Fundamental para agentes que precisam iniciar ou redirecionar fluxos de interação em diferentes sites.

BlockRefreshPage (Posterior)
Função: Atualiza a página atual.
Justificativa: Pode ser útil para recarregar informações, mas não é essencial para o MVP.

BlockNavigateBack/Forward (Posterior)
Função: Permite navegar para trás ou para frente no histórico do navegador.
Justificativa: Para fluxos de navegação mais complexos; pode ser implementado em versões futuras.

## 4. Integração com IA (ChatGPT)
BlockAiGenerateText (MVP)

- Função: Envia um prompt para o ChatGPT e armazena o texto gerado em uma variável.
- Justificativa: Núcleo da integração com IA, possibilitando a criação de respostas dinâmicas.

BlockAiConditional (MVP)

- Função: Executa uma lógica condicional baseada na resposta da IA (if/else dinâmico).
- Justificativa: Permite criar fluxos que se adaptam às saídas da IA, tornando o agente mais interativo.

BlockAiSetContext (Posterior)

- Função: Define ou atualiza o contexto/memória para conversas subsequentes com a IA.
- Justificativa: Importante para diálogos mais complexos e contínuos, porém pode ser incorporado após o MVP.

BlockAiChatMessage (Posterior)

- Função: Gerencia o envio e recebimento de mensagens em um fluxo de chat.
- Justificativa: Facilita a criação de interações estilo chat, adicionando mais naturalidade à conversa com a IA em futuras versões.

## 5. Controle de Fluxo e Lógica (Blocos já existentes no Blockly)
Blocos de Variáveis, Condicionais, Loops, Operadores, etc.

- Função: Permitem o controle do fluxo de execução e manipulação de dados.
- Justificativa: São essenciais para qualquer linguagem de programação visual e já estão disponíveis no Blockly.

## 6. Sincronização e Espera
BlockDelay/Wait (MVP)

- Função: Introduz um atraso na execução de ações.
- Justificativa: Essencial para sincronizar interações, principalmente em páginas dinâmicas ou ao aguardar respostas da IA.

BlockWaitForResponse (Posterior)

- Função: Aguarda a resposta de uma chamada assíncrona (por exemplo, do ChatGPT).
- Justificativa: Melhora o controle de fluxos que dependem de respostas externas, podendo ser incorporado em versões futuras.

## 7. Ações Auxiliares e Depuração
BlockLogAction (MVP/Opcional)

- Função: Exibe mensagens de log para depuração no console.
- Justificativa: Útil para monitorar e solucionar problemas durante o desenvolvimento e uso do agente.

BlockCaptureScreenshot (Posterior)

- Função: Captura uma imagem da tela ou de um elemento específico.
- Justificativa: Pode servir para registro de ações ou debug avançado, sendo uma funcionalidade complementar.