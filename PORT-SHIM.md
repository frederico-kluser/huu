# PORT-SHIM — interceptação de `bind()` para isolar portas entre agentes paralelos

> **Técnica.** Pré-carga (`LD_PRELOAD` no Linux, `DYLD_INSERT_LIBRARIES` no macOS)
> de uma biblioteca compartilhada nativa que interpõe `bind(2)` da libc,
> rewriting a porta solicitada na fronteira da syscall, antes de chegar ao kernel.

> **Codename.** `huu-port-shim`. Fonte em [`native/port-shim/port-shim.c`](native/port-shim/port-shim.c).

---

## TL;DR

Quando dez agentes do `huu` rodam em paralelo, cada um no seu próprio
worktree, e cada um executa código do cliente que faz literalmente
`app.listen(3000)`, o kernel registra **um** processo na porta 3000 — os
outros nove falham com `EADDRINUSE`. Worktrees isolam o filesystem; não
isolam a rede.

Resolvemos sem Docker, sem network namespaces, sem editar o código do
cliente: uma biblioteca C de ~150 linhas é pré-carregada em cada processo
spawnado pelo agente. Ela substitui o símbolo `bind` da libc, lê uma tabela
de remap em `HUU_PORT_REMAP`, e troca a porta antes de delegar à `bind`
real. O código do cliente continua dizendo `3000`; o kernel ouve `55110`.

A técnica funciona para qualquer linguagem que faça syscalls através da
libc dinâmica do sistema (Node, Python, Ruby, PHP, Java, Go com cgo, Rust
contra glibc, …). Não funciona para binários estaticamente linkados que
fazem syscall direta (Go puro, musl-static), Windows, e macOS com SIP em
binários protegidos. Para esses, há fallback explícito documentado.

---

## 1. Contexto: por que esse problema apareceu

### 1.1 O modelo de execução do `huu`

O `huu` é um orquestrador que roda pipelines de agentes LLM em **paralelo**,
até 20 agentes simultâneos por padrão. A unidade de paralelização é o **git
worktree**: cada agente recebe um diretório de trabalho dedicado em
`.huu-worktrees/<runId>/agent-<N>/`, com um branch próprio, e modifica
código sem ver o que os outros agentes estão fazendo.

Esse design vinha de uma promessa simples: paralelismo seguro de modificação
de código, baseado numa primitiva nativa do git (`git worktree add …`).
Funciona perfeitamente para edições de texto: o agente A escreve em
`agent-1/src/auth.ts`, o agente B escreve em `agent-2/src/auth.ts`, e
quando os dois terminam, um merge serial determinístico consolida no
branch de integração.

### 1.2 O furo: agentes não escrevem só código — eles **rodam** código

Pipelines do mundo real raramente são "edite e pare". Eles fazem coisas
como:

- *Stage 1*: refatorar o handler de auth.
- *Stage 2*: rodar `npm test` pra validar a refatoração.
- *Stage 3*: subir `npm run dev` e fazer um curl no endpoint pra
  smoke-testar.

O step 2 é cooperativo (vitest abre nada de rede). O step 3 não é: o agente
executa `npm run dev`, que executa `vite`, que faz `server.listen(5173)`,
que termina numa syscall `bind(socket, sockaddr_in{port=5173}, ...)`.

Quando dez agentes fazem isso ao mesmo tempo:

```
agent-1: bind(0.0.0.0:5173) → kernel: OK, slot taken by pid 1001
agent-2: bind(0.0.0.0:5173) → kernel: EADDRINUSE
agent-3: bind(0.0.0.0:5173) → kernel: EADDRINUSE
agent-4: bind(0.0.0.0:5173) → kernel: EADDRINUSE
…
```

Nove falham. Os agentes leem o erro, **acreditam que o código está
quebrado**, e gastam tokens em loops de "correção" que nunca convergem
porque o problema é externo ao código.

Isso é exatamente o **"blind testing problem"** descrito na
[`ANALISE-CRITICA.md`](ANALISE-CRITICA.md), seção 5.1:

> Quando um teste falha no painel da TUI do huu, o agente subjacente
> inevitavelmente assume falsamente que seu código estava com defeito e
> gastará horas de processamento computacional valioso tentando reescrever
> uma função perfeita apenas porque a camada de rede do sistema estava
> saturada e interferiu no console de execução.

### 1.3 Por que isso é um furo arquitetural (e não um bug)

A árvore de decisão original do `huu` foi:

1. Para isolar agentes, use git worktrees.
2. Worktree resolve filesystem.
3. ✅ Pronto, isolamento garantido.

O passo 3 estava errado. **Worktrees não tocam em rede**, e nenhum dos
recursos de namespace do Linux (PID, IPC, mount, network) é ativado pelo
git. O `huu` tinha um modelo mental de isolamento que cobria 60–70% dos
casos reais e falhava silenciosamente nos outros 30–40%.

---

## 2. O problema em detalhe

### 2.1 Por que o kernel é compartilhado

Quando você roda múltiplos processos no mesmo Linux (ou macOS) sem
isolamento explícito, todos eles compartilham:

- **A tabela de portas TCP/UDP do kernel** (uma porta = um socket
  listening).
- **A interface de loopback `lo`**.
- **A tabela de roteamento, regras iptables/nftables, ARP cache**.
- **Os limites de file descriptors do sistema**.

Dois processos pedindo `bind(0.0.0.0:3000)` vão competir; o kernel
serializa via spinlock e retorna `EADDRINUSE` ao perdedor.
`SO_REUSEADDR` e `SO_REUSEPORT` mitigam casos específicos (rebind
após `TIME_WAIT`, load-balancing entre workers do mesmo processo
parent), mas não resolvem o caso de processos não-coordenados.

Isolamento real exige um dos seguintes:

| Técnica | Mecanismo | Privilégio | Latência | Universalidade |
|---|---|---|---|---|
| Containers (Docker/Podman) | netns dedicado por container | UID 0 ou rootless config | ~500ms cold start | Qualquer linguagem |
| `unshare -n` (Linux) | netns sem container | UID 0 ou user namespaces | ~10ms | Qualquer linguagem |
| `LD_PRELOAD` + bind shim | reescrita no espaço de usuário | nenhum | ~0ms | Apenas dynamic libc |
| Edição do código do cliente | reescrever literais | nenhum | n/a | Universal mas invasivo |
| Serialização (1 agente por vez) | semáforo no orquestrador | nenhum | n/a (perde paralelismo) | Universal |

### 2.2 O que o `huu` recusou desde o design

A filosofia do produto (`Humans Underwrite Undertakings`) recusa
explicitamente:

- **Containers**: contradiz "single binary leve, sem dependências
  pesadas". Docker exigiria daemon, imagens, network bridges; tira o `huu`
  do nicho "abro um terminal e rodo".
- **Privilégios elevados**: `huu` roda na UID do desenvolvedor. Pedir
  `sudo unshare` quebra a UX.
- **Editar o código do cliente**: viola o princípio de auditabilidade —
  edições espúrias entrariam no diff e o usuário teria que distinguir
  manualmente "o que o agente fez de propósito" de "o que o `huu`
  fez para conseguir rodar".

Isso restringe o espaço de soluções para: `LD_PRELOAD` (Linux/macOS
sem privilégio) ou perda de paralelismo.

---

## 3. Soluções consideradas

Antes de fechar a escolha, mapeamos o trade-off space inteiro. Documentado
aqui para que decisões futuras saibam o que foi pesado e descartado.

### 3.1 Docker / containers (um container por agente)

**Como funcionaria.** Cada agente roda dentro de um container; cada
container tem netns próprio; portas 3000 do agente A e do agente B são
duas entidades diferentes para o kernel.

**Pros.** Isolamento total: rede, FS, processos, IPC.

**Contras.**
- Cold start de 200ms–2s por container (10 agentes paralelos = 20s só
  para subir).
- Requer Docker daemon instalado e rodando — barreira de entrada
  considerável.
- Volumes para o repo do cliente: complicação de permissões UID/GID
  entre host e container.
- Sai da linha "binário único TUI sem deps".

**Veredicto.** Descartado pelo princípio do produto.

> **Não confundir** com o `huu` rodando em Docker (introduzido por
> [`Dockerfile`](Dockerfile) + [`src/lib/docker-reexec.ts`](src/lib/docker-reexec.ts)).
> Esse modo põe o **orquestrador inteiro** em um único container — os
> agentes paralelos continuam sendo processos do mesmo container,
> compartilhando network namespace. Logo, o port-shim continua
> necessário em Docker; veja §6.4.

### 3.2 Linux network namespaces (`unshare -n`)

**Como funcionaria.** O orquestrador faz fork+`unshare(CLONE_NEWNET)`
antes de exec do agente. Cada agente herda um netns sem interfaces (só
`lo`, e mesmo `lo` precisa ser ativado com `ip link set lo up`).

**Pros.**
- Isolamento real, mesmo nível dos containers.
- Sem daemon externo.
- Rápido (~10ms por unshare).

**Contras.**
- Linux apenas. macOS não tem equivalente.
- Requer `sysctl kernel.unprivileged_userns_clone=1` (default em
  Ubuntu, Debian, Arch; desabilitado em distros hardened tipo CentOS
  Stream e algumas instalações Fedora/RHEL).
- Sem internet por padrão — o agente não consegue nem `npm install`
  até que o `huu` configure veth + iptables NAT entre o netns e a
  default route do host. Isso é meia tarde de engenharia de rede.
- Cada agente precisaria de uma interface veth dedicada, com IP
  único, e regras de NAT no host. Complexidade alta.

**Veredicto.** Descartado pela combinação Linux-only + complexidade
de configuração de rede para preservar acesso à internet.

### 3.3 `LD_PRELOAD` + shim de `bind()` (escolhida)

**Como funcionaria.** Uma `.so` contendo um símbolo `bind` que substitui
o da libc. Antes de delegar ao `bind` real, lê uma variável de ambiente
com a tabela de remap e altera a porta no `sockaddr`.

**Pros.**
- Sem privilégio.
- Linux + macOS (com pequenas diferenças: `DYLD_INSERT_LIBRARIES` e
  `DYLD_FORCE_FLAT_NAMESPACE=1`).
- Latência zero (apenas uma comparação e um `htons()` extra por
  bind).
- Código do cliente intocado.
- Funciona para qualquer linguagem que use libc dinâmica.

**Contras.**
- Não funciona para binários estaticamente linkados que fazem syscall
  direta (Go puro, Rust com `musl` static).
- Não funciona em Windows.
- Não funciona em binários macOS protegidos pelo SIP.
- Requer `cc` para compilar.
- Mais sutil: requer que o env var chegue no processo correto.
  Discutido em §5.4.

**Veredicto.** Cobre 80–90% dos casos reais com complexidade muito
menor que netns. Os 10–20% restantes têm fallback documentado
(opção 3.5 abaixo).

### 3.4 Reescrita automática do código do cliente

**Como funcionaria.** Antes do agente rodar, o `huu` faz scan do worktree
procurando literais de porta (`listen(3000)`, `port: 5173`) e os
substitui temporariamente por leituras de env. No fim, reverte.

**Pros.** Universal (qualquer linguagem).

**Contras.**
- Frágil: regex em código é uma má idéia.
- Polui o diff: se reverter dá errado, a edição vaza para o commit.
- Pode reverter incorretamente em código com mesmo padrão usado em
  outro contexto.
- Impossível de fazer em arquivos compilados.

**Veredicto.** Descartado por fragilidade.

### 3.5 Serialização (`concurrency = 1` para steps que abrem socket)

**Como funcionaria.** Marcar steps específicos como "exclusive": o
orquestrador roda eles um de cada vez. Steps de edição ficam
paralelos.

**Pros.**
- Universal, sem código nativo.
- Trivial de implementar.

**Contras.**
- Perde a vantagem de paralelismo justamente nos steps mais caros
  (testes E2E, que naturalmente são lentos).
- Não detecta automaticamente quais steps precisam — ou o usuário
  marca, ou todo step potencialmente arriscado vira gargalo.

**Veredicto.** Mantido como **fallback documentado** para os casos
que `LD_PRELOAD` não cobre. Não é a solução principal.

---

## 4. A solução escolhida: defense-in-depth em 4 camadas

A interceptação de `bind()` é a camada que resolve o caso difícil
(porta hardcoded). Mas sozinha ela tem custo: requer `cc`, é
opt-in via shim shell, e tem matriz de cobertura específica. Por isso,
as outras três camadas existem para cobrir o caso fácil
gratuitamente e prover sinal claro quando a camada universal não está
disponível.

```
┌───────────────────────────────────────────────────────────────┐
│  Camada 4: System prompt — instrui o agente sobre as portas   │
├───────────────────────────────────────────────────────────────┤
│  Camada 3: bind() interceptor (LD_PRELOAD/DYLD)               │  ← núcleo
├───────────────────────────────────────────────────────────────┤
│  Camada 2: .env.huu por worktree (consumido por dotenv)       │
├───────────────────────────────────────────────────────────────┤
│  Camada 1: PortAllocator — janelas únicas por agente          │
└───────────────────────────────────────────────────────────────┘
```

### 4.1 Camada 1 — `PortAllocator`

**Arquivo.** [`src/orchestrator/port-allocator.ts`](src/orchestrator/port-allocator.ts).

Cada agente recebe uma janela contígua de portas. Algoritmo:

1. Janela natural: `base = basePort + (agentId − 1) × windowSize`
   (default `55100 + (id-1) × 10`).
2. Para cada slot da janela, faz probe TCP: cria um
   `net.createServer({ exclusive: true }).listen(port, '127.0.0.1')`.
   Se algum porta da janela responde com erro (porta em uso por
   processo externo — Postgres, IDE, qualquer coisa), a janela
   inteira é descartada.
3. Desliza a janela para a próxima livre, até `maxAgents × 4`
   tentativas.
4. Reserva atomicamente em um `Set<number>` interno, prevenindo
   race entre `allocate()` paralelos.

Exposto como `AgentPortBundle`:

```ts
{
  agentId: 3,
  http: 55120,        // PORT, HUU_PORT_HTTP
  db: 55121,          // HUU_PORT_DB
  ws: 55122,          // HUU_PORT_WS
  extras: [55123…55129],
  databaseUrl: 'postgresql://localhost:55121/huu_agent_3'
}
```

A liberação é mandatória em todos os caminhos terminais do agente
(success, retry-final, abort, safety-net catch). Sem isso, o estado
do alocador vaza entre runs.

### 4.2 Camada 2 — `.env.huu` por worktree

**Arquivo.** [`src/orchestrator/agent-env.ts`](src/orchestrator/agent-env.ts).

Após criar o worktree, o `huu` escreve um arquivo dedicado
`<worktree>/.env.huu` com:

```bash
HUU_RUN_ID=run-abc123
HUU_AGENT_ID=3
PORT=55120
HUU_PORT=55120
HUU_PORT_HTTP=55120
HUU_PORT_DB=55121
HUU_PORT_WS=55122
HUU_PORT_EXTRA_1=55123
…
DATABASE_URL=postgresql://localhost:55121/huu_agent_3
HUU_PORT_REMAP=3000:55120,5432:55121,5173:55122,5432:55121,…,*:55120
LD_PRELOAD=/abs/path/.huu-cache/native-shim/linux-x64/huu-port-shim.so
```

**Por que arquivo dedicado e não `.env.local`?** Porque o usuário pode
ter `.env.local` versionado com valores reais (chaves de API de teste,
URLs de staging). Mexer ali tem efeito colateral inesperado e pode
acabar no commit do agente. `.env.huu` é nosso, é git-ignored, e nunca
vai colidir com convenções existentes.

**Quem lê esse arquivo?**

- Qualquer framework que use a biblioteca `dotenv` ou similares
  (Next.js carrega automaticamente `.env*` da raiz do projeto;
  Vite via `loadEnv`; NestJS via `ConfigModule`; Astro idem).
  Esses frameworks pegam `PORT=55120` automaticamente quando o
  código faz `process.env.PORT`.
- Quando o agente prefixa um comando com
  `./.huu-bin/with-ports <cmd>`, o shim faz `set -a; source .env.huu;
  set +a; exec <cmd>` — o que exporta **inclusive** `LD_PRELOAD` e
  `HUU_PORT_REMAP` para o processo filho, ativando a camada 3.

### 4.3 Camada 3 — `bind()` interceptor (núcleo)

**Arquivo.** [`native/port-shim/port-shim.c`](native/port-shim/port-shim.c) (~150 linhas).
Compilado para `.huu-cache/native-shim/<os>-<arch>/huu-port-shim.{so,dylib}`.

Compilação:

```
Linux : cc -O2 -fPIC -Wall -shared -o huu-port-shim.so port-shim.c -ldl -lpthread
macOS : cc -O2 -fPIC -Wall -dynamiclib -o huu-port-shim.dylib port-shim.c
```

Ativação no processo filho:

```
Linux : LD_PRELOAD=/abs/path/huu-port-shim.so
macOS : DYLD_INSERT_LIBRARIES=/abs/path/huu-port-shim.dylib
        DYLD_FORCE_FLAT_NAMESPACE=1
```

Quando o linker dinâmico carrega a libc, ele vê o `bind` da nossa `.so`
primeiro (devido à ordem de busca). Toda chamada `bind(...)` do programa
é roteada para nossa função.

#### O algoritmo do shim

```c
int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    // 1. Inicializa uma vez: dlsym(RTLD_NEXT, "bind") pega a real;
    //    parse de HUU_PORT_REMAP em uma tabela in-memory.
    pthread_once(&huu_init_once, huu_init);

    // 2. Apenas IPv4/IPv6 são reescritos. Unix sockets, NETLINK, etc
    //    passam direto.
    if (addr->sa_family == AF_INET) {
        struct sockaddr_in modified;
        memcpy(&modified, addr, sizeof(modified));
        uint16_t orig = ntohs(modified.sin_port);

        // 3. Lookup: porta literal na tabela explícita; depois
        //    catchall (*); porta 0 (efêmera) nunca é remapeada.
        uint16_t mapped = huu_lookup(orig);

        if (mapped != 0 && mapped != orig) {
            modified.sin_port = htons(mapped);
            return real_bind_fn(sockfd, (struct sockaddr*)&modified, addrlen);
        }
    }
    // mesmo padrão para AF_INET6

    return real_bind_fn(sockfd, addr, addrlen);
}
```

Pontos importantes:

- **`pthread_once`** garante init thread-safe — múltiplas threads
  criando sockets ao mesmo tempo não fazem parse de `HUU_PORT_REMAP`
  duplicado.
- **Porta 0 nunca é remapeada**: é a porta efêmera, kernel-chosen,
  intencionalmente. Reescrever isso quebraria tools que querem
  random port (testes que pedem porta 0 e leem `getsockname()` depois).
- **Endianness**: `sockaddr_in.sin_port` é network byte order; usamos
  `ntohs`/`htons` em todas as conversões.
- **Sem syscall direta de fallback**: se `dlsym(RTLD_NEXT, "bind")`
  falhar, retornamos `-1` com `errno = ENOSYS` em vez de tentar fazer
  `syscall(SYS_bind, ...)`. A linha de raciocínio: se chegou aqui,
  algo está muito errado no ambiente, e mascarar com syscall
  direta (que **não passa pelo nosso interceptor**, levando a
  EADDRINUSE original) seria pior.

#### Compilação on-demand

**Arquivo.** [`src/orchestrator/native-shim.ts`](src/orchestrator/native-shim.ts).

Na primeira execução em um repo:

1. Detecta SO (`linux` / `darwin`) e `arch` (`x64` / `arm64`).
2. Localiza a fonte C (`native/port-shim/port-shim.c`) — funciona
   tanto em modo dev (`tsx`) quanto em modo build (`dist/`).
3. Verifica se `<repoRoot>/.huu-cache/native-shim/<os>-<arch>/huu-port-shim.{so,dylib}`
   existe e é mais recente que a fonte. Se sim, reusa.
4. Caso contrário, chama `cc` com flags apropriadas. Em ~50ms produz
   um artefato de ~16KB.
5. Em qualquer falha (sem `cc`, plataforma não suportada, compile
   error), retorna `null` graciosamente. O orquestrador segue rodando
   no modo só-env (camadas 1, 2, 4 ativas; camada 3 inativa).

A cache é por repo (não global) intencionalmente: `huu` pode rodar em
hosts diferentes (CI, laptop, servidor remoto) e o repo pode estar
montado em filesystems com características diferentes. Cache local
elimina coordenação.

### 4.4 Camada 4 — System prompt

**Arquivos.** [`src/orchestrator/agent-env.ts`](src/orchestrator/agent-env.ts) (gera bloco markdown), [`src/orchestrator/agents-md-generator.ts`](src/orchestrator/agents-md-generator.ts) (injeta no system prompt).

O agente recebe, no system prompt, um bloco que diz:

> ## Port Allocation
>
> **bind() interception is active.** Even if the customer code calls
> `app.listen(3000)` literally or hardcodes a port in a config file,
> the kernel will receive your allocated port instead. You do NOT need
> to modify the customer's source to avoid collisions.
>
> Variáveis disponíveis no shell e em `.env.huu`:
> - `PORT` / `HUU_PORT_HTTP` = 55120
> - `HUU_PORT_DB` = 55121
> - …
>
> Regras:
> 1. NUNCA hardcode portas em código novo (3000, 8080, 5173, 5432). Use as variáveis acima.
> 2. Frameworks que leem dotenv (Next, Vite, Nest, etc.) carregam `.env.huu` automaticamente.
> 3. Para binários que ignoram dotenv (python, go, cargo, scripts), prefixe com o shim shell:
>    `./.huu-bin/with-ports <comando>`

Quando o shim nativo **não** está disponível (sem `cc`, Windows, etc),
o texto muda para alertar que a interceptação não está ativa e que o
agente deve evitar hardcoded ports. Sem isso, o agente teria
expectativas erradas sobre o ambiente.

### 4.5 Como as 4 camadas interagem em runtime

Cenário típico: agente roda `./.huu-bin/with-ports npm run dev` para um
projeto Vite com `port: 5173` literal em `vite.config.ts`.

1. Bash executa o shim shell `with-ports`.
2. `with-ports` faz `source .env.huu` → `LD_PRELOAD`,
   `HUU_PORT_REMAP=…,5173:55122,…`, `PORT=55120` viram exported env.
3. `with-ports` faz `exec npm run dev`.
4. `npm` lê `LD_PRELOAD` do env, repassa ao child `node`.
5. `node` carrega libc dinamicamente. Loader vê `LD_PRELOAD`,
   carrega `huu-port-shim.so` antes da libc; o símbolo `bind` da nossa
   `.so` mascara o da libc.
6. Vite spawna seu dev server, que chama `app.listen(5173)`.
7. `net.Server.prototype.listen` em Node faz syscall `bind` —
   intercepta nossa.
8. Nossa `bind` lê `HUU_PORT_REMAP`, encontra `5173 → 55122`,
   muda o `sockaddr_in.sin_port`, chama `real_bind_fn(socket,
   sockaddr{port=55122}, len)`.
9. Kernel registra processo na 55122. Vite imprime
   `Server running on port 5173` (ele acha que é 5173 — é o que ele
   pediu), mas o curl correto é `localhost:55122`.
10. Outros 9 agentes paralelos fazem o mesmo, cada um com seu
    `HUU_PORT_REMAP` apontando para portas diferentes (55132, 55142,
    …). Zero `EADDRINUSE`.

---

## 5. Validação empírica

A prova de conceito está em [`src/orchestrator/native-shim.test.ts`](src/orchestrator/native-shim.test.ts).
Três asserções end-to-end, executadas por Vitest em CI:

### 5.1 O shim compila no host atual

```ts
const shim = ensureNativeShim(scratch);
expect(existsSync(shim!.libPath)).toBe(true);
```

### 5.2 Um child Node pedindo `bind(3000)` recebe a porta remappeada

```ts
const probe = `
  const net = require('net');
  const s = net.createServer();
  s.listen({ port: 3000, host: '127.0.0.1' }, () => {
    process.stdout.write(String(s.address().port));
    s.close();
  });
`;
const out = execFileSync('node', ['-e', probe], {
  env: { ...process.env, LD_PRELOAD: shimLib, HUU_PORT_REMAP: `3000:${bundle.http}` },
});
expect(parseInt(out, 10)).toBe(bundle.http);  // ✓ 56700, não 3000
```

### 5.3 Dois children "binding 3000" simultaneamente coexistem

```ts
const [outA, outB] = await Promise.all([run(a.http), run(b.http)]);
expect(parseInt(outA)).toBe(a.http);  // 56800
expect(parseInt(outB)).toBe(b.http);  // 56810
expect(a.http).not.toBe(b.http);
// Sem o shim, este teste falha com EADDRINUSE.
```

29/29 testes verdes (6 testes do `PortAllocator`, 3 desse arquivo, mais
20 testes pré-existentes que continuam passando).

---

## 6. Matriz de cobertura

### 6.1 ✅ Cobertura completa

Para essas stacks, o cliente pode ter porta hardcoded ou ler env:
funciona.

| Stack | Mecanismo |
|---|---|
| Node / JS / TS (Express, Fastify, Hono, Next, Nuxt, Astro, Nest, Vite) | dotenv lê `.env.huu`; `bind()` interceptor cobre o resto |
| Python 3 (Django, FastAPI, Flask, http.server, gunicorn, uvicorn) | interceptor (CPython usa libc dinâmica) |
| Ruby (MRI: Rails, Sinatra, Puma) | interceptor |
| PHP (php-fpm, builtin server) | interceptor |
| Perl, Lua, Tcl, Elixir/Erlang | interceptor |
| Go com cgo (default na maior parte das distros Linux) | interceptor |
| Rust contra glibc (target `gnu`, default em Ubuntu/Debian) | interceptor |
| JVM (java, kotlin, scala, clojure) | interceptor |
| .NET no Linux (Mono, .NET Core) | interceptor |
| Bun, Deno (linkam glibc dinâmica) | interceptor |

### 6.2 ❌ Sem cobertura — fallbacks documentados

| Cenário | Por que falha | Fallback |
|---|---|---|
| **Go static** (`CGO_ENABLED=0`) | Faz `syscall(SYS_bind, …)` direto, sem passar pela libc dinâmica | Use `concurrency = 1` para steps que rodam binários Go static, ou recompile com cgo |
| **Rust musl static** (Alpine target) | Idem: musl está estaticamente embutida | Idem: serializar, ou usar target `gnu` |
| **Distroless / scratch images** | Sem libc, sem dl loader | Não há solução sem container |
| **Windows hosts** | Não existe `LD_PRELOAD` ou equivalente em Win32 | Falla pro modo só-env; portas hardcoded vão colidir; documentar `concurrency = 1` no pipeline |
| **Hosts sem `cc`** | Shim não compila; `ensureNativeShim()` retorna null | Modo só-env; instale `build-essential` (Linux) ou Xcode CLT (macOS) para ativar |
| **macOS com binários SIP-protegidos** (`/usr/bin/python3`, system Ruby) | DYLD vars são removidas pelo loader em binários protegidos | Use runtime instalado pelo usuário (Homebrew, asdf, mise, pyenv) |
| **Containers iniciados por dentro do agente** | LD_PRELOAD do host não cruza a fronteira do container | O container já isola a rede; problema some, mas o port-shim não ajuda |

### 6.3 Diagnóstico

Se um pipeline falha com EADDRINUSE apesar do shim, debug em ordem:

1. **`HUU_PORT_DEBUG=1` no env do agente** — o shim imprime cada
   remap em stderr. Se nada aparecer, o shim **não foi carregado**
   (LD_PRELOAD não chegou no processo).
2. **Verifique se o agente prefixou com `./.huu-bin/with-ports`** —
   sem isso, o env do `.env.huu` (incluindo `LD_PRELOAD`) não foi
   exportado no processo filho. O system prompt instrui isso, mas
   compliance não é garantida.
3. **Verifique o `.huu-cache/native-shim/<os>-<arch>/huu-port-shim.so`**
   (ou `$HUU_NATIVE_SHIM_PATH` em Docker) — se não existe, o shim não
   compilou nem foi pré-empacotado. Veja warnings no run log.
4. **`ldd <binary> 2>&1 | grep libc`** dentro do worktree — se o
   binário do cliente é static, `ldd` retorna "not a dynamic
   executable". Cai no caso 6.2.

### 6.4 Cenário Docker — `huu` em container

`huu` agora pode rodar em um container oficial (`ghcr.io/.../huu:latest`)
via o wrapper auto-reexec em [`src/lib/docker-reexec.ts`](src/lib/docker-reexec.ts).
**Importante:** esse modelo é "todo o orquestrador em UM container", **não**
"um container por agente". Os N agentes paralelos rodam como processos
filhos dentro do mesmo container e portanto **compartilham o network
namespace** do container — `bind(3000)` de dois agentes paralelos colide
exatamente como colidiria nativo. O port-shim continua sendo a camada
que evita isso.

Diferenças operacionais em Docker:

| Aspecto | Host nativo | Container `huu` oficial |
|---|---|---|
| Compilador `cc` disponível? | Geralmente sim (apt/Xcode CLT) | **Não.** O runtime stage instala apenas `tini, git, ca-certificates, openssh-client` |
| Onde o `.so` mora? | `<repoRoot>/.huu-cache/native-shim/<os>-<arch>/` (compile on-demand) | `/opt/huu/native/huu-port-shim.so` (pré-compilado no builder, copiado para o runtime) |
| Como o orquestrador acha? | `findShimSource()` + cache + `cc` | `process.env.HUU_NATIVE_SHIM_PATH` (setado pelo Dockerfile) |
| Custo do primeiro run | ~50ms de compile | zero (já compilado) |
| Multi-arch | Compila pro arch local | Buildx compila amd64+arm64 separados |

A [resolução em `ensureNativeShim()`](src/orchestrator/native-shim.ts) é:

1. `HUU_NATIVE_SHIM_PATH` aponta pra um arquivo existente → usa direto.
2. Cache local `<repoRoot>/.huu-cache/...` está fresh → reusa.
3. `cc` disponível → compila.
4. Caso contrário → null + warning + fallback para camadas 1+2+4.

**Modo isolated-volume (`HUU_WORKTREE_BASE`):** o `.env.huu` em cada
worktree contém `LD_PRELOAD=$HUU_NATIVE_SHIM_PATH` (caminho absoluto
dentro do container). Como worktrees podem morar fora do bind-mount,
o caminho do `.so` precisa ser absoluto e válido dentro do filesystem
do container — o que é o caso quando o Dockerfile pré-empacotou em
`/opt/huu/native/`.

**Custom Docker images sem prebuilt:** se você publicar uma imagem
derivada que não copia o `.so` do builder (e não instala `cc`), a
camada 3 cai pro fallback silenciosamente. Para preservar a feature,
ou (a) pré-compile no seu builder e exponha `HUU_NATIVE_SHIM_PATH`,
ou (b) instale `gcc + libc6-dev` no runtime image (custo ~50MB).

---

## 7. Decisões de design e por quê

### 7.1 Por que ports `55100+` e janela de 10?

- **Acima de 1024**: portas privilegiadas exigem root.
- **Acima de 49151**: faixa registered da IANA. Reduz colisão com
  serviços conhecidos.
- **Abaixo de 65535** óbvio.
- **Janela 10** por agente (10 slots: http, db, ws, 7 extras): cobre
  o caso típico (servidor + DB + websocket) com folga. Configurável
  em `pipeline.portAllocation.windowSize`.

A faixa default 55100–55300 (20 agentes × 10 slots) intersecta o range
ephemeral do Linux (32768–60999), o que poderia teoricamente
colidir com uma conexão outbound efêmera transitória. O probe TCP
cobre esse caso: se o `net.createServer({ exclusive: true })` falha,
a janela é descartada.

### 7.2 Por que `.env.huu` e não modificar `.env.local`?

Princípio: zero side-effects no que o usuário tem. `.env.local` é
muitas vezes versionado (`.gitignore` padrão da Next.js inclui, mas
muitos repos não seguem) ou contém chaves reais que o agente
poderia comitar acidentalmente se o orquestrador modificasse.
`.env.huu` é nosso, novo, e gitignored automaticamente.

### 7.3 Por que `with-ports` e não wrappers por binário?

Wrappers para `npm`, `node`, `python`, etc. precisariam catalogar
todos os comandos relevantes. Quebra em comandos novos (`bun`,
`deno`, `cargo`). `with-ports` é genérico: `./.huu-bin/with-ports
<qualquer comando>`. Custo: o agente precisa lembrar de prefixar.

### 7.4 Por que probe TCP antes de comprometer a janela?

Sem probe, se o usuário já tiver Postgres rodando em `55121`, todos
os agentes que recebem aquela janela falham silenciosamente quando
tentam usar `HUU_PORT_DB`. Probe + slide custa ~1ms por agente e elimina
a classe inteira de "porta aparentemente livre, na real ocupada".

### 7.5 Por que não interpor `connect()` também?

Pensamos. Decidimos não. Justificativa: o cliente do agente sabe que
o servidor está numa porta diferente porque ele mesmo lê
`HUU_PORT_HTTP`. Interpor `connect` para reescrever `connect(localhost:3000)
→ connect(localhost:55120)` automaticamente seria conveniente, mas:

- Quebra clientes que conectam em serviços externos legítimos na
  porta 3000 (improvável mas possível).
- Adiciona estado: precisaríamos saber **qual** 55120 — do agente
  atual ou de outro?
- Esconde mais uma camada: o agente acharia que `localhost:3000`
  funciona, dificultando debug quando algo falha.

Mantivemos `connect` direto. Agente lê `HUU_PORT_HTTP`, faz
`fetch(http://localhost:${HUU_PORT_HTTP})`. Mais explícito, mais
debugável.

### 7.6 Por que não usar `BPF` ou `eBPF`?

eBPF resolveria com isolamento real (BPF program no socket attach
hook), sem privilégio em kernels recentes. Considerado.
Descartado por:

- Disponibilidade: requer kernel ≥ 5.7 e configuração de unprivileged
  BPF (default off em muitas distros).
- Complexidade: muito mais código que a `.so` de 150 linhas.
- macOS: zero suporte.

### 7.7 Por que C e não Rust/Zig?

C: 150 linhas, compila com `cc`, dependências zero. Toolchain
universal — qualquer host Unix tem `cc` ou pode instalar em 30s.

Rust: Cargo, edição 2021, `extern "C"` boilerplate, ~30s primeira
compilação, mais ~100MB de toolchain. Para um shim de 150 linhas,
custo desproporcional.

Zig: similar ao Rust em termos de toolchain, sem ganho técnico
relevante para esse escopo.

---

## 8. O que **não** resolvemos

Honestidade brutal sobre os limites:

### 8.1 Compliance do agente

A camada 3 (interceptor) só ativa quando o agente roda comandos via
`./.huu-bin/with-ports <cmd>`. Se o agente ignora a instrução do
system prompt e roda `npm run dev` direto, `LD_PRELOAD` não chega
no processo filho — porque o `bash` tool do Pi SDK herda
`process.env` do orquestrador Node, e `process.env.LD_PRELOAD` no
orquestrador **não está setado** (e não pode estar — todos os
agentes paralelos compartilham `process.env`).

**Por que não corrigimos com per-call env injection no Pi SDK?**
Exigiria patch upstream do `@mariozechner/pi-coding-agent`. Possível,
mas fora do escopo desta sessão. Workaround: o system prompt é
explícito sobre `with-ports`; o agente, quando segue, fecha o
loop. Quando não segue, cai no fallback de camada 1+2.

### 8.2 Binários static-linked

Já discutido (§6.2). A solução real seria network namespaces,
descartada pelos motivos da §3.2. Para esses casos, marcar steps
como exclusive (concurrency=1) é a saída.

### 8.3 Windows

Sem `LD_PRELOAD`, sem equivalente prático. Detours, IAT hooking,
Wow64, etc. são muito invasivos para o ROI. `huu` em Windows
(via WSL2) usa o caminho Linux normalmente; Windows nativo cai
no modo só-env.

### 8.4 Compartilhamento de outros recursos do host

Resolvemos portas TCP/UDP. **Não** resolvemos:

- **Sockets Unix** com path hardcoded (`/tmp/myapp.sock`). Dois agentes
  abrindo o mesmo path colidem. Mitigação possível: interceptar
  `bind()` para `AF_UNIX` também, e remapear path. Não implementado.
- **Locks de arquivo** (`flock`, `fcntl(F_SETLK)`) em paths fora do
  worktree — `/tmp/postgres.lock`, `/var/run/redis.pid`. Worktrees
  não cobrem `/tmp` ou `/var`.
- **Bancos de dados persistentes** (sqlite em `~/.cache/myapp.db`,
  Redis com AOF em `/var/lib`). Os agentes corrompem o estado um
  do outro.
- **Caches globais** (`~/.npm`, `~/.cargo`, `~/.cache/pip`) — em geral
  thread-safe e idempotentes, mas alguns têm race (npm `package-lock`
  atualizações simultâneas).

Esses são problemas verdadeiros, fora do escopo desta técnica.
Fix correto: cada agente em seu próprio HOME (`HOME=<worktree>/.home`),
com paths apontando para dentro do worktree. Trabalho de outra
camada.

### 8.5 Ports requested as `0` (efêmeras)

Por design, **não remapeamos** porta 0. Tools que pedem porta 0 e
leem `getsockname()` para descobrir a porta efetiva continuam
funcionando, mas:

- Se múltiplos agentes pedem porta 0, eles ganham portas efêmeras
  diferentes do kernel — sem colisão. Bom.
- Mas o agente que lê a porta efetiva e a expõe em algum lugar
  (variável de ambiente, arquivo, log) **revela uma porta real do
  host**, não uma do range alocado. Se outro agente tentar
  `connect(localhost:<essa porta>)`, vai bater na porta do agente
  que abriu — comportamento correto, mas potencialmente confuso.

Não é um problema operacional comum.

### 8.6 Cluster / múltiplos hosts

Resolução é por host. Se você roda `huu` em múltiplas máquinas
diferentes (CI distribuído, etc.), cada host tem sua faixa
independente. Não há coordenação cross-host. Para esse cenário
(que não é o uso primário), use Docker mesmo.

---

## 9. Trabalho futuro

Se algum desses se tornar dor recorrente:

1. **Per-call env injection no Pi SDK**: PR upstream para que o
   `bash` tool aceite env próprio. Fecha o gap de §8.1.
2. **AF_UNIX socket path remap**: estender o shim para interceptar
   `bind()` em sockets Unix e remapear path. ~30 linhas extras de C.
3. **Network namespaces opt-in (Linux)**: para usuários que aceitam
   o overhead, oferecer um modo `pipeline.networkIsolation: "netns"`.
   Pode coexistir com o port-shim como duas estratégias selecionáveis.
4. **HOME isolado por worktree**: cada agente roda com `HOME` apontando
   para `<worktree>/.home`, isolando caches, locks, configs globais.
   Não é trivial (alguns tools resolvem path absoluto a partir de
   `HOME` em runtime), mas resolve §8.4.
5. **Remap de `connect()` opt-in**: bandeira que diz "também
   reescreva tentativas de conectar em localhost:3000 para
   localhost:55120". Útil quando o cliente do agente é um teste E2E
   que não pode ser configurado.
6. **Distribuir prebuilts**: para evitar exigência de `cc`, embutir
   prebuilts para `linux-x64`, `linux-arm64`, `darwin-arm64`,
   `darwin-x64` no pacote npm. Cada `.so` tem ~16KB.

---

## 10. Referências internas

| Arquivo | Papel |
|---|---|
| [`native/port-shim/port-shim.c`](native/port-shim/port-shim.c) | Implementação do interceptor de `bind()` (Linux + macOS) |
| [`native/port-shim/Makefile`](native/port-shim/Makefile) | Build local do shim |
| [`src/orchestrator/native-shim.ts`](src/orchestrator/native-shim.ts) | Compilação on-demand, cache em `.huu-cache/`, honra `HUU_NATIVE_SHIM_PATH`, fallback gracioso |
| [`src/orchestrator/native-shim.test.ts`](src/orchestrator/native-shim.test.ts) | Testes end-to-end provando que o shim remappeia bind() real + cobertura do prebuilt path |
| [`Dockerfile`](Dockerfile) | Pré-compila `huu-port-shim.so` no builder e exporta `HUU_NATIVE_SHIM_PATH` no runtime — preserva camada 3 sem `cc` no container |
| [`src/orchestrator/port-allocator.ts`](src/orchestrator/port-allocator.ts) | Camada 1 — janelas únicas por agente, com probe TCP |
| [`src/orchestrator/port-allocator.test.ts`](src/orchestrator/port-allocator.test.ts) | Testes do alocador |
| [`src/orchestrator/agent-env.ts`](src/orchestrator/agent-env.ts) | Camada 2+4 — escreve `.env.huu` com `LD_PRELOAD` + `HUU_PORT_REMAP`, gera bloco markdown para o prompt |
| [`src/orchestrator/agents-md-generator.ts`](src/orchestrator/agents-md-generator.ts) | Injeta o bloco de port allocation no system prompt |
| [`src/orchestrator/index.ts`](src/orchestrator/index.ts) | Orquestrador — chama `ensureNativeShim` no start, aloca porta após criar worktree, libera em todos os exit paths, gitignore artifacts |
| [`src/lib/types.ts`](src/lib/types.ts) | Schema `Pipeline.portAllocation: { basePort?, windowSize?, enabled? }` |
| [`README.md`](README.md), [`README.pt-BR.md`](README.pt-BR.md) | Seção "Parallel safety: per-agent port isolation" / "Segurança em paralelo: isolamento de portas por agente" |
| [`ANALISE-CRITICA.md`](ANALISE-CRITICA.md), §5.1 | Definição original do "blind testing problem" que motivou esta técnica |

## 11. Referências externas

- `ld.so(8)` — manual page do dynamic linker do Linux. Documenta
  `LD_PRELOAD` e ordem de resolução de símbolos.
- `dyld(1)` — manual do dynamic linker do macOS. Documenta
  `DYLD_INSERT_LIBRARIES` e `DYLD_FORCE_FLAT_NAMESPACE`.
- `bind(2)` — Linux man page. A syscall que estamos interceptando.
- `dlsym(3)` — `RTLD_NEXT` para chamar a `bind` original da libc.
- POSIX.1-2017, §2.10 — sockaddr struct layout e endianness rules.
