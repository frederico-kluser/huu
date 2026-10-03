# Prompt do benchmark — MESMO texto para os dois harnesses

> Byte-idêntico para DSH e `huu dev`. Sem prescrever stack (o harness escolhe —
> é a variável sob teste); requisitos enumeráveis e testáveis um a um; termina
> numa app que corre local.

Constrói uma aplicação full-stack de gestão de tarefas (task tracker) que corre
localmente com UM comando de arranque.

Requisitos funcionais:
1. Tarefas com título, descrição, estado (todo/doing/done), prioridade
   (low/medium/high) e data de criação. Criar, editar, mudar estado e apagar.
2. Persistência real: os dados sobrevivem a reiniciar a aplicação (ficheiro ou
   base local — o que decidires).
3. API REST própria (pelo menos GET/POST/PATCH/DELETE em /api/tasks), com
   validação de entrada e respostas de erro coerentes.
4. Interface web única: lista de tarefas, formulário de criação/edição, filtros
   por estado e prioridade, e pesquisa por texto no título — tudo sem recarregar
   a página.
5. Estados visuais explícitos: vazio (sem tarefas), carregamento, erro de API e
   sucesso após cada ação. Ações destrutivas (apagar) pedem confirmação.
6. Aparência cuidada: tipografia consistente, espaçamento ritmado, hierarquia
   visual clara e composição equilibrada — uma interface com identidade, não um
   CRUD genérico de framework sem estilo.

Critérios de aceitação:
- Um único comando arranca a aplicação (backend + frontend juntos).
- O fluxo completo criar → editar → mudar estado → apagar funciona de fio a
  pavio sem recarregar a página.
- Os dados persistem entre reinícios da aplicação.
- Se a API falhar (servidor em baixo ou erro simulado), a interface mostra o
  estado de erro de forma legível em vez de quebrar.
