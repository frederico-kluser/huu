# Tutorial: Criando Robôs Autônomos com Blocos

## Introdução: O que são os robôs autônomos?

Bem-vindo ao nosso sistema de robôs autônomos! Com esta ferramenta, você poderá criar pequenos agentes (robôs) que realizam tarefas automaticamente em sites, sem precisar saber programação.

Os agentes que você criar podem:
- Navegar em sites
- Clicar em botões e links
- Preencher formulários
- Extrair informações
- Tomar decisões inteligentes

E o melhor: tudo isso usando blocos visuais que se encaixam como peças de quebra-cabeça!

## Primeiros Passos: Configuração Inicial

### Configurando sua API Key

Ao abrir a extensão pela primeira vez, você precisará configurar sua chave de API:

1. Insira sua chave de API OpenAI no campo indicado
2. Clique em "Salvar"

(PRINT 1: Tela de configuração inicial mostrando o campo para inserir a API key da OpenAI)

### Conhecendo as Três Telas Principais

Nossa extensão possui três telas principais que você utilizará:

1. **Tela Inicial (Lista de Agentes)**: Mostra os agentes disponíveis para a URL atual
2. **Tela de Edição de Agentes**: Permite configurar nome e URLs dos agentes
3. **Tela de Edição de Blocos**: Onde você monta a lógica do seu agente com blocos

(PRINT 2: Colagem mostrando as três telas principais lado a lado com legendas)

## Tela Inicial: Gerenciando seus Agentes

Após configurar sua API key, você verá a tela inicial que mostra os agentes disponíveis para o site atual.

Nesta tela você pode:
- Ver todos os agentes compatíveis com a URL atual
- Ativar ou desativar cada agente (por padrão, eles estão desativados)
- Criar novos agentes
- Acessar a tela de edição de agentes

(PRINT 3: Tela inicial mostrando a lista de agentes com botões de ativar/desativar e os botões "Criar Agente" e "Editar Agentes")

## Criando seu Primeiro Agente

### Criando um Novo Agente

Para criar seu primeiro agente:

1. Na tela inicial, clique no botão "Criar Agente"
2. Aparecerá uma janela (prompt) solicitando o nome do agente
3. Digite um nome descritivo como "Pesquisador Google"
4. Após confirmar, você será direcionado automaticamente para a tela de edição de blocos

(PRINT 4: Sequência mostrando o botão "Criar Agente", o prompt de nome e a transição para a tela de edição de blocos)

### A Tela de Edição de Blocos

Na tela de edição de blocos, você verá:

1. **Área de trabalho**: Espaço central onde você montará seus blocos
2. **Categorias de blocos**: Menu lateral com todos os blocos disponíveis  
3. **Barra de ferramentas**: No topo, com opções para salvar, testar e executar

(PRINT 5: Tela de edição de blocos com números indicando cada componente mencionado acima)

### Seu Primeiro Agente: Pesquisar no Google

Vamos criar um agente simples que:
1. Abre o Google
2. Digita uma pesquisa na barra de busca

#### Passo 1: Adicionar o bloco de navegação

1. Clique na categoria "Navegação" no menu lateral
2. Arraste o bloco "Visitar site" para a área de trabalho
3. Clique no campo de texto e digite "www.google.com"

**Importante**: Os blocos de navegação (Visitar site, Voltar página, Avançar página e Atualizar página) já esperam automaticamente o carregamento completo da página. Não é necessário adicionar blocos de pausa após eles.

(PRINT 6: Mostrando o bloco "Visitar site" na área de trabalho com "www.google.com" digitado)

#### Passo 2: Selecionar um elemento da página

1. Clique na categoria "Interação com a Página"
2. Arraste o bloco "Selecionar elemento visualmente" e conecte-o ao bloco anterior
3. Clique no botão "Selecionar" dentro do bloco

(PRINT 7: Os dois blocos conectados, com destaque para o botão "Selecionar" no bloco de seleção de elemento)

#### Passo 3: Quando você clica no botão "Selecionar"

A extensão ativará o modo de seleção visual. Você verá os elementos da página destacados à medida que passa o mouse sobre eles.

1. Passe o mouse sobre a barra de pesquisa do Google
2. Quando ela ficar destacada em azul, clique para selecioná-la

(PRINT 8: Tela do Google com a barra de pesquisa destacada em azul pela ferramenta de seleção)

#### Passo 4: Digitar texto no elemento selecionado

1. Clique na categoria "Interação com a Página"
2. Arraste o bloco "Digitar texto" e conecte-o ao bloco anterior
3. Clique no primeiro campo e selecione o elemento que você capturou no passo anterior
4. No segundo campo, digite "robôs autônomos"

(PRINT 9: Todos os blocos conectados, com destaque para o bloco "Digitar texto" configurado)

#### Passo 5: Salvar e Testar seu agente

1. Clique no botão "Salvar" na barra de ferramentas para salvar seu agente
2. Clique no botão "Testar" para testar seu agente antes de ativá-lo
3. Observe como o agente abre o Google e digita na barra de pesquisa!

(PRINT 10: Barra de ferramentas com destaque para os botões "Salvar" e "Testar")

### Configurando seu Agente na Tela de Edição de Agentes

Após criar seu agente, você pode configurar em quais URLs ele poderá funcionar:

1. Volte para a tela inicial
2. Clique no botão "Editar Agentes"
3. Na tela de edição de agentes, você verá seu novo agente na lista
4. Você pode:
   - Editar o nome do agente
   - Adicionar ou remover URLs onde o agente pode funcionar
   - Selecionar outro agente para editar através do menu suspenso

(PRINT 11: Tela de edição de agentes mostrando as opções para configurar um agente)

### Ativando seu Agente

Para usar seu agente:

1. Volte para a tela inicial
2. Encontre seu agente na lista
3. Clique no botão de ativar ao lado do seu agente (mudará de cinza para verde)
4. Seu agente agora está pronto para executar automaticamente quando você acessar o Google!

(PRINT 12: Tela inicial mostrando o agente com o botão de ativar destacado e em estado ativado)

Parabéns! Você acaba de criar e ativar seu primeiro agente autônomo!

## Navegando entre as Três Telas Principais

### Como Alternar entre as Telas

É importante entender como navegar entre as três telas principais da nossa extensão:

1. **Tela Inicial → Tela de Edição de Agentes**:
   - Clique no botão "Editar Agentes" na tela inicial

2. **Tela de Edição de Agentes → Tela Inicial**:
   - Clique no botão "Voltar" no topo da tela de edição de agentes

3. **Tela de Edição de Agentes → Tela de Edição de Blocos**:
   - Clique no botão "Editar" ao lado do agente que deseja modificar

4. **Tela Inicial → Tela de Edição de Blocos**:
   - Clique no botão "Criar Agente", digite o nome e será redirecionado automaticamente

5. **Tela de Edição de Blocos → Tela Inicial**:
   - Clique no botão "Salvar e Voltar" na barra de ferramentas

(PRINT 13: Diagrama visual mostrando as conexões entre as três telas com setas indicando como navegar entre elas)

## Entendendo as Categorias de Blocos

Agora que você já criou seu primeiro agente, vamos conhecer melhor as categorias de blocos disponíveis:

### Interação com a Página

Estes blocos permitem interagir com elementos de um site:

- **Selecionar elemento visualmente**: Permite clicar diretamente no elemento que deseja interagir
- **Encontrar elemento na página**: Localiza um elemento usando texto, ID ou outras propriedades
- **Clicar**: Simula um clique do mouse em um elemento
- **Digitar texto**: Insere texto em campos
- **Copiar texto**: Extrai o texto de um elemento para usar depois

(PRINT 15: Categoria "Interação com a Página" expandida mostrando todos os blocos)

### Navegação

Blocos para navegar entre páginas:

- **Visitar site**: Abre um endereço web específico
- **Atualizar página**: Recarrega a página atual
- **Voltar página**: Retorna à página anterior
- **Avançar página**: Vai para a próxima página

(PRINT 16: Categoria "Navegação" expandida mostrando todos os blocos)

### Controles

Blocos para controlar o fluxo do agente:

- **Pausar**: Espera um tempo antes de continuar
- **Mostrar mensagem**: Exibe uma mensagem na tela
- **Se... Então...**: Executa ações diferentes dependendo de uma condição
- **Pedir confirmação**: Pergunta ao usuário se deseja continuar

(PRINT 17: Categoria "Controles" expandida mostrando todos os blocos)

### Loops e Repetições

Blocos para repetir ações automaticamente:

- **Repetir N vezes**: Repete uma sequência de ações um número específico de vezes
- **Para cada item na lista**: Executa ações para cada item de uma lista
- **Para cada elemento na página**: Repete ações para cada elemento encontrado na página

(PRINT 18: Categoria "Loops e Repetições" expandida mostrando todos os blocos)

### Assistente Inteligente

Blocos que usam inteligência artificial:

- **Perguntar ao assistente**: Faz uma pergunta para a IA e usa a resposta
- **Resumir texto**: Pede para a IA criar um resumo de um texto
- **Extrair informações**: Identifica dados específicos como emails, telefones, endereços

(PRINT 19: Categoria "Assistente Inteligente" expandida mostrando todos os blocos)

### Dados

Blocos para trabalhar com informações:

- **Criar variável**: Cria um espaço para guardar informação
- **Definir valor**: Muda o valor de uma variável existente
- **Lista**: Cria uma lista para armazenar vários itens

(PRINT 20: Categoria "Dados" expandida mostrando todos os blocos)

## Projeto: Criando um Agente para Pesquisar Preços

Agora vamos criar um agente mais útil que pesquisa o preço de um produto em um site de comércio eletrônico.

### Passo 1: Criar um novo agente

1. Na tela inicial, clique em "Criar Agente"
2. Dê o nome de "Pesquisador de Preços" ao seu agente
3. Você será direcionado para a tela de edição de blocos

(PRINT 19: Tela mostrando a criação do novo agente "Pesquisador de Preços")

### Passo 2: Configurar a navegação inicial

1. Arraste o bloco "Visitar site" para a área de trabalho
2. Digite "www.exemplo.com" (substituir pelo site real de e-commerce)

(PRINT 20: Bloco "Visitar site" com URL do site de e-commerce)

### Passo 3: Encontrar e interagir com a barra de pesquisa

1. Adicione o bloco "Selecionar elemento visualmente" 
2. Clique em "Selecionar" e escolha a barra de pesquisa do site
3. Adicione o bloco "Digitar texto" e configure para o produto que deseja pesquisar, por exemplo: "smartphone modelo X"
4. Adicione o bloco "Selecionar elemento visualmente" novamente
5. Clique em "Selecionar" e escolha o botão de pesquisa
6. Adicione o bloco "Clicar" para clicar no botão de pesquisa

(PRINT 21: Sequência de blocos para pesquisar um produto, com destaque para a seleção visual da barra de pesquisa)

### Passo 4: Esperar os resultados e capturar o preço

**Nota**: Neste caso, precisamos de um bloco de pausa porque estamos esperando que elementos dinâmicos (os resultados da pesquisa) apareçam após a página inicial já ter carregado.

1. Adicione o bloco "Pausar" (2-3 segundos para carregar os resultados dinâmicos)
2. Adicione o bloco "Selecionar elemento visualmente"
3. Clique em "Selecionar" e escolha o elemento que contém o preço do produto
4. Adicione o bloco "Copiar texto" para extrair o valor do preço

(PRINT 22: Blocos para capturar o preço do produto, com destaque para a seleção visual do elemento de preço)

### Passo 5: Mostrar o resultado

1. Adicione o bloco "Mostrar mensagem"
2. Configure a mensagem para mostrar "O preço do produto é: " seguido pelo valor capturado

(PRINT 25: Bloco "Mostrar mensagem" configurado para exibir o preço)

### Passo 6: Salvar e testar o agente

1. Clique em "Salvar" para salvar seu agente
2. Clique em "Testar" para ver seu agente em ação
3. Observe como ele navega para o site, pesquisa o produto e extrai o preço automaticamente!

(PRINT 26: Botão de "Testar" destacado e tela mostrando a mensagem final com o preço capturado)

### Passo 7: Configurar URLs e ativar o agente

1. Volte para a tela inicial
2. Acesse a tela de edição de agentes
3. Adicione os URLs onde seu agente deve funcionar (por exemplo, adicione o domínio da loja)
4. Volte para a tela inicial e ative seu agente

(PRINT 27: Tela de edição de agentes mostrando o campo para adicionar URLs e depois a tela inicial com o agente ativado)

## Como Usar Loops para Coletar Múltiplas Informações

E se você quiser verificar os preços de vários produtos de uma vez? Vamos aprender a usar loops!

### Exemplo: Pesquisar Vários Produtos

1. Edite seu agente "Pesquisador de Preços"
2. Primeiro, crie uma lista de produtos:
   - Adicione o bloco "Lista" da categoria "Dados"
   - Clique em "Adicionar Item" várias vezes para inserir os nomes dos produtos

(PRINT 28: Bloco "Lista" com vários produtos adicionados)

3. Agora, adicione um loop para cada produto:
   - Adicione o bloco "Para cada item na lista" da categoria "Loops e Repetições"
   - Selecione a lista de produtos que você criou
   - Dentro do loop, adicione os mesmos blocos que usamos antes para pesquisar um produto

(PRINT 29: Estrutura de loop "Para cada item na lista" com os blocos de pesquisa dentro)

Agora seu agente pesquisará cada produto da lista, um após o outro!

## Usando a Inteligência Artificial

Vamos ver como a IA pode tornar seu agente ainda mais poderoso.

### Exemplo: Analisar Descrições de Produtos

1. Crie um novo agente chamado "Analisador de Produtos" na tela inicial
2. Use o fluxo de blocos semelhante ao exemplo anterior, mas adicione:
   - Um bloco "Selecionar elemento visualmente" para selecionar a descrição do produto
   - Um bloco "Copiar texto" para extrair a descrição
   - Um bloco "Resumir texto" da categoria "Assistente Inteligente"
   - Configure para usar a descrição extraída
   - Adicione um bloco "Mostrar mensagem" para exibir o resumo gerado pela IA

(PRINT 30: Blocos mostrando o fluxo para extrair uma descrição e usar IA para resumir)

### Exemplo: Decidir se Vale a Pena Comprar

1. Continue o agente anterior, adicionando:
   - Um bloco "Decisão Sim/Não" após extrair preço e características do produto
   - Configure a pergunta: "O produto [nome] por [preço] com [características] vale a pena comprar?"
   - No caminho "SIM", adicione um bloco para mostrar "Recomendado: bom custo-benefício!"
   - No caminho "NÃO", adicione um bloco para mostrar "Não recomendado: há melhores opções"

(PRINT 31: Bloco "Decisão Sim/Não" configurado para avaliar um produto, com os dois caminhos possíveis)

## Gerenciando Múltiplos Agentes

Uma das vantagens do nosso sistema é a possibilidade de criar vários agentes para diferentes tarefas:

1. Você pode ter um agente para cada site ou tipo de tarefa
2. Na tela de edição de agentes, você pode alternar entre seus diferentes agentes usando o menu suspenso
3. Na tela inicial, você pode ativar ou desativar cada agente conforme necessário

(PRINT 32: Tela de edição de agentes mostrando o menu suspenso para alternar entre agentes e a tela inicial com vários agentes listados)

## Dicas para Criar Agentes Eficientes

1. **Usar pausas somente quando necessário**: Os blocos de navegação já esperam a página carregar completamente. Adicione pausas apenas quando precisar esperar por elementos dinâmicos que carregam após o carregamento inicial da página.

2. **Quando usar pausas**:
   - Após clicar em um botão que gera conteúdo dinâmico sem mudar de página
   - Para esperar animações ou sliders concluírem
   - Quando um site carrega conteúdo em etapas, mesmo após a página inicial estar pronta

3. **Trate erros**: Use o bloco "Tentar... Recuperar..." para criar um plano B caso algo falhe.

4. **Seja específico ao selecionar elementos**: Quanto mais preciso for ao selecionar elementos, mais confiável será seu agente.

5. **Teste em pequenas partes**: Não crie um agente grande de uma vez. Crie pequenas partes e teste cada uma.

6. **Configure corretamente as URLs**: Na tela de edição de agentes, configure com precisão em quais URLs seu agente deve funcionar.

7. **Use mensagens para acompanhar**: Adicione mensagens para mostrar o progresso do agente.

(PRINT 31: Exemplo visual de um agente bem estruturado com uso apropriado de pausas e tratamento de erros)

## Exemplos de Uso

Aqui estão algumas ideias de agentes que você pode criar:

1. **Monitoramento de preços**: Verifica diariamente se o preço de um produto caiu
2. **Agregador de notícias**: Coleta os principais títulos de vários sites de notícias
3. **Preenchimento de formulários**: Automatiza o preenchimento de dados em sites
4. **Extrator de contatos**: Coleta informações de contato de uma lista de empresas
5. **Assistente de pesquisa**: Busca informações sobre um tópico em múltiplas fontes

(PRINT 34: Tela inicial mostrando exemplos de agentes já criados na interface)

---

Parabéns! Agora você tem conhecimento suficiente para criar seus próprios agentes autônomos. Lembre-se de que a prática leva à perfeição, então comece com tarefas simples e vá aumentando a complexidade gradualmente.

Divirta-se automatizando!
