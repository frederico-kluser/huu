#!/bin/bash
# =============================================================================
# benchmark-jcode-subagents.sh — Medicao de Consumo de RAM de Sub-agentes jcode
# =============================================================================
#
# Este script mede o consumo de memoria RAM (RSS) de sub-agentes jcode rodando
# em paralelo, cada um criando um projeto simples (README.md). O objetivo e
# quantificar o custo real de orquestracao multi-agente com tarefas de filesystem.
#
# Cenarios testados (default):
#   1. Baseline: RAM livre antes de qualquer jcode
#   2. 1 sub-agente:  cria "Projeto Teste 1"
#   3. 2 sub-agentes: criam "Projeto A" e "Projeto B" em paralelo
#   4. 5 sub-agentes: criam 5 projetos em paralelo
#
# Para cada cenario, o script:
#   - Lanca N processos jcode em background
#   - Monitora o RSS de cada processo via ps a cada 0.5s
#   - Registra pico individual e total
#   - Calcula: media RSS/agente, custo marginal, estimativa para 10 agentes
#   - Compara com benchmarks do t-8000 (~47 MB/sessao jcode run deepseek-v4-pro)
#
# DEPENDENCIAS:
#   - jcode : CLI do agente (default: ~/.local/bin/jcode)
#   - ps, awk : ferramentas de sistema
#
# USO:
#   ./benchmark-jcode-subagents.sh
#   ./benchmark-jcode-subagents.sh --model deepseek-v4-pro --max-parallel 5
#   ./benchmark-jcode-subagents.sh --provider-profile deepseek-v4 --model deepseek-v4-pro
#
# VARIAVEIS DE AMBIENTE:
#   JCODE_BIN              Caminho para o binario jcode (default: ~/.local/bin/jcode)
#   JCODE_MEMORY_ENABLED   Forcado como false internamente para zero embeddings
#
# EXIT CODE:
#   0   Sucesso (todos os benchmarks executados)
#   1   Erro de configuracao (jcode ausente, flags invalidas)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Cores ANSI (desligadas se output nao for TTY)
# -----------------------------------------------------------------------------
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    CYAN='\033[0;36m'
    MAGENTA='\033[0;35m'
    BOLD='\033[1m'
    DIM='\033[2m'
    NC='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' MAGENTA='' BOLD='' DIM='' NC=''
fi

# -----------------------------------------------------------------------------
# Configuracoes default
# -----------------------------------------------------------------------------
JCODE_BIN="${JCODE_BIN:-$HOME/.local/bin/jcode}"
MODEL="deepseek-v4-pro"
PROVIDER_PROFILE="deepseek-v4-pro"
MAX_PARALLEL=5
TIMEOUT_PER_SESSION=300   # segundos (sub-agentes criam arquivos, precisam de mais tempo)
POLL_INTERVAL=0.5          # segundos entre medicoes de RSS
SCRIPT_NAME="$(basename "$0")"

# Cenarios de teste (hardcoded: 1, 2, 5)
TEST_SESSIONS=(1 2 5)

# Rastreador global de diretorios temporarios (para cleanup no EXIT)
_TEMP_DIRS=()

# -----------------------------------------------------------------------------
# Benchmarks de referencia do t-8000
# -----------------------------------------------------------------------------
# jcode run com deepseek-v4-pro no t-8000: ~47 MB/sessao (RSS medio)
# Fonte: benchmark-jcode-ram.sh do repo t-8000
REF_T8000_RSS_PER_SESSION=47       # MB por sessao (aproximado)
REF_T8000_1_SESSION=47             # MB — 1 sessao
REF_T8000_5_SESSIONS=235           # MB — 5 sessoes (~47 * 5, custo quase linear)

# -----------------------------------------------------------------------------
# Nomes de projeto por indice (para sub-agentes criarem arquivos distintos)
# -----------------------------------------------------------------------------
PROJECT_NAMES=(
    "Projeto Alpha"
    "Projeto Bravo"
    "Projeto Charlie"
    "Projeto Delta"
    "Projeto Echo"
    "Projeto Foxtrot"
    "Projeto Golf"
    "Projeto Hotel"
    "Projeto India"
    "Projeto Juliet"
)

# -----------------------------------------------------------------------------
# usage — exibe documentacao de uso e sai
# -----------------------------------------------------------------------------
usage() {
    cat << 'EOF'
BENCHMARK-JCODE-SUBAGENTS(1) — Medicao de Consumo de RAM de Sub-agentes jcode

NOME
    benchmark-jcode-subagents.sh — benchmark de consumo RSS com 1/2/5
                                   sub-agentes jcode em paralelo

SINOPSE
    benchmark-jcode-subagents.sh [opcoes]

DESCRICAO
    Mede o consumo de memoria RAM (Resident Set Size — RSS) de sub-agentes
    jcode executando tarefas reais de criacao de arquivos em paralelo.

    Diferente do benchmark-jcode-ram.sh (que testa sessoes com prompt
    trivial "Responda: OK"), este script simula sub-agentes de orquestracao
    real — cada um cria um projeto com README.md distinto.

    Cenarios testados:
      1. Baseline: RAM livre antes de qualquer processo jcode
      2. 1 sub-agente:  cria README.md com "Projeto Alpha"
      3. 2 sub-agentes: criam "Projeto Alpha" e "Projeto Bravo" em paralelo
      4. 5 sub-agentes: criam 5 projetos em paralelo

    Para cada cenario, o script:
      1. Mede RAM livre (baseline)
      2. Lanca N processos jcode em background, cada um em seu proprio
         diretorio temporario isolado
      3. Monitora o RSS de cada processo via ps a cada 0.5s
      4. Registra o pico de RSS individual e total
      5. Calcula: media RSS/agente, custo marginal
      6. Projeta estimativa para 10 agentes
      7. Compara com benchmarks do t-8000 (~47 MB/sessao)

    JCODE_MEMORY_ENABLED=false e forcado em TODOS os subprocessos para
    garantir zero consumo de embeddings nas medicoes.

OPCOES
    --model <NAME>            Modelo LLM (default: deepseek-v4-pro)
    --provider-profile <NAME> Provider profile (default: deepseek-v4-pro)
    --max-parallel <N>        Maximo de agentes paralelos (default: 5)
    --help, -h                Esta documentacao

EXEMPLOS
    # Benchmark padrao (deepseek-v4-pro, 1-2-5 agentes)
    benchmark-jcode-subagents.sh

    # Apenas ate 2 agentes paralelos
    benchmark-jcode-subagents.sh --max-parallel 2

    # Modelo alternativo
    benchmark-jcode-subagents.sh --model deepseek-chat --provider-profile deepseek

AMBIENTE
    JCODE_BIN    Caminho para o binario jcode (default: ~/.local/bin/jcode)

EXIT CODE
    0   Sucesso
    1   Erro de configuracao
EOF
}

# -----------------------------------------------------------------------------
# check_dependencies — verifica se as dependencias estao instaladas
# -----------------------------------------------------------------------------
check_dependencies() {
    local missing=()

    if [[ ! -x "$JCODE_BIN" ]]; then
        missing+=("jcode (nao encontrado em $JCODE_BIN)")
    fi

    if ! command -v ps &>/dev/null; then
        missing+=("ps (comando de sistema)")
    fi

    if ! command -v awk &>/dev/null; then
        missing+=("awk (processamento de texto)")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo -e "${RED}[ERRO]${NC} Dependencias ausentes:" >&2
        for dep in "${missing[@]}"; do
            echo "  - $dep" >&2
        done
        exit 1
    fi

    # Verifica versao do jcode
    local jcode_version
    jcode_version=$("$JCODE_BIN" --version 2>&1 | head -1) || true
    if [[ -n "$jcode_version" ]]; then
        echo -e "  ${DIM}jcode: $jcode_version${NC}"
    fi
}

# -----------------------------------------------------------------------------
# get_system_memory — captura memoria total/usada/livre do sistema
#
# Retorna no formato (stdout): <total_kb> <used_kb> <free_kb>
# Funciona em macOS (vm_stat) e Linux (/proc/meminfo).
# -----------------------------------------------------------------------------
get_system_memory() {
    local total_kb=0
    local used_kb=0
    local free_kb=0

    if [[ "$(uname -s)" == "Darwin" ]]; then
        # macOS: usa sysctl + vm_stat
        local page_size
        page_size=$(pagesize 2>/dev/null || sysctl -n hw.pagesize 2>/dev/null || echo 16384)

        # Memoria total em bytes
        local total_bytes
        total_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
        total_kb=$((total_bytes / 1024))

        # Paginas do vm_stat
        local vm_stats
        vm_stats=$(vm_stat 2>/dev/null)

        # Extrai contadores (valores em paginas)
        local pages_free pages_active pages_inactive pages_wired pages_compressed pages_speculative
        pages_free=$(echo "$vm_stats" | grep "Pages free:" | grep -oE '[0-9]+' || echo 0)
        pages_active=$(echo "$vm_stats" | grep "Pages active:" | grep -oE '[0-9]+' || echo 0)
        pages_inactive=$(echo "$vm_stats" | grep "Pages inactive:" | grep -oE '[0-9]+' || echo 0)
        pages_wired=$(echo "$vm_stats" | grep "Pages wired down:" | grep -oE '[0-9]+' || echo 0)
        pages_compressed=$(echo "$vm_stats" | grep "Pages occupied by compressor:" | grep -oE '[0-9]+' || echo 0)
        pages_speculative=$(echo "$vm_stats" | grep "Pages speculative:" | grep -oE '[0-9]+' || echo 0)

        # Livre = free + inactive (inactive pode ser reutilizado)
        local pages_free_total=$((pages_free + pages_inactive))
        free_kb=$((pages_free_total * page_size / 1024))

        # Usado = active + wired + compressed + speculative
        local pages_used=$((pages_active + pages_wired + pages_compressed + pages_speculative))
        used_kb=$((pages_used * page_size / 1024))

    elif [[ -f /proc/meminfo ]]; then
        # Linux: le /proc/meminfo
        local meminfo
        meminfo=$(cat /proc/meminfo 2>/dev/null)

        local mem_total mem_available mem_free
        mem_total=$(echo "$meminfo" | grep "^MemTotal:" | awk '{print $2}')
        mem_available=$(echo "$meminfo" | grep "^MemAvailable:" | awk '{print $2}')
        mem_free=$(echo "$meminfo" | grep "^MemFree:" | awk '{print $2}')

        total_kb="${mem_total:-0}"
        free_kb="${mem_available:-${mem_free:-0}}"
        used_kb=$((total_kb - free_kb))
    else
        # Fallback: nao foi possivel determinar
        echo "0 0 0"
        return
    fi

    echo "$total_kb $used_kb $free_kb"
}

# -----------------------------------------------------------------------------
# format_mb — converte KB para string formatada em MB
# -----------------------------------------------------------------------------
format_mb() {
    local kb=$1
    local mb
    mb=$(awk "BEGIN {printf \"%.1f\", $kb / 1024}")
    echo "${mb} MB"
}

# -----------------------------------------------------------------------------
# get_process_rss — retorna RSS em KB de um PID, ou 0 se nao encontrado
# -----------------------------------------------------------------------------
get_process_rss() {
    local pid=$1
    local rss
    rss=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d '[:space:]')
    if [[ -n "$rss" && "$rss" =~ ^[0-9]+$ && "$rss" -gt 0 ]]; then
        echo "$rss"
    else
        echo "0"
    fi
}

# -----------------------------------------------------------------------------
# build_prompt — gera o prompt para um sub-agente criar um projeto
#
# Argumentos:
#   $1 — nome do projeto (ex: "Projeto Alpha")
#
# Retorna (stdout): string do prompt
# -----------------------------------------------------------------------------
build_prompt() {
    local project_name="$1"
    cat <<PROMPT
Crie um arquivo README.md com o seguinte conteudo:
# ${project_name}

Este e um projeto de teste gerado automaticamente pelo benchmark de sub-agentes jcode.

## Descricao
Projeto criado para medir o consumo de RAM de sub-agentes em paralelo.

## Status
- [x] Criado por sub-agente jcode
- [x] Benchmark em execucao

Nao execute nenhum outro comando alem de criar o arquivo README.md.
PROMPT
}

# -----------------------------------------------------------------------------
# run_parallel_test — lanca N sub-agentes jcode e mede consumo RSS
#
# Cada sub-agente roda em seu proprio diretorio temporario isolado e cria
# um README.md com nome de projeto unico.
#
# Argumentos:
#   $1 — numero de sub-agentes (N)
#
# Retorna (stdout, uma linha):
#   N|<media_rss_kb>|<pico_total_rss_kb>|<rss_min_kb>|<rss_max_kb>|<elapsed_s>
#
# Efeitos colaterais:
#   - Cria N diretorios temporarios (um por agente)
#   - Cria diretorio de medicoes
#   - Limpa ao final (trap garante cleanup mesmo em erro)
# -----------------------------------------------------------------------------
run_parallel_test() {
    local n_agents=$1
    local bench_dir
    bench_dir=$(mktemp -d /tmp/jcode-subagent-bench.XXXXXX)

    # Registra para cleanup global (EXIT trap)
    _TEMP_DIRS+=("$bench_dir")

    local agents_dir="$bench_dir/agents"
    mkdir -p "$agents_dir"

    echo -e "  ${CYAN}Preparando $n_agents diretorio(s) isolado(s)...${NC}" >&2

    # Cria diretorio isolado para cada agente
    for ((i = 0; i < n_agents; i++)); do
        local agent_dir="$agents_dir/agent_${i}"
        mkdir -p "$agent_dir"
    done

    echo -e "  ${CYAN}Lancando $n_agents sub-agente(s) jcode...${NC}" >&2

    local pids=()
    local start_time
    start_time=$(date +%s)

    # -------------------------------------------------------------------------
    # Fase 1: Lancamento dos sub-agentes
    # -------------------------------------------------------------------------
    for ((i = 0; i < n_agents; i++)); do
        local agent_dir="$agents_dir/agent_${i}"
        local project_name="${PROJECT_NAMES[$i]:-Projeto Teste $((i + 1))}"
        local prompt
        prompt=$(build_prompt "$project_name")

        # Log separado para stdout e stderr do agente
        local agent_log="$bench_dir/agent_${i}.log"
        local agent_stderr="$bench_dir/agent_${i}.err"

        # Forca JCODE_MEMORY_ENABLED=false em todos os subprocessos
        JCODE_MEMORY_ENABLED=false \
        JCODE_TELEMETRY=0 \
        JCODE_SKIP_VERSION_CHECK=1 \
        "$JCODE_BIN" run \
            --provider-profile "$PROVIDER_PROFILE" \
            --model "$MODEL" \
            --cwd "$agent_dir" \
            --no-update \
            "$prompt" \
            > "$agent_log" 2> "$agent_stderr" &

        pids+=($!)
        echo -e "    ${DIM}Agente $((i + 1))/${n_agents}: PID=${pids[$i]}, dir=$agent_dir${NC}" >&2
    done

    # Pequena pausa para garantir que todos os processos iniciaram
    sleep 2

    # -------------------------------------------------------------------------
    # Fase 2: Monitoramento de RSS
    # -------------------------------------------------------------------------
    local poll_file="$bench_dir/rss_polls.log"
    local max_total_rss=0
    local poll_count=0

    echo -e "  ${DIM}Monitorando RSS a cada ${POLL_INTERVAL}s...${NC}" >&2

    while true; do
        local all_dead=true
        local current_total=0
        local poll_time
        poll_time=$(date +%s)

        for pid in "${pids[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                all_dead=false
                local rss
                rss=$(get_process_rss "$pid")
                if [[ "$rss" -gt 0 ]]; then
                    current_total=$((current_total + rss))
                    echo "$poll_time $pid $rss" >> "$poll_file"
                fi
            fi
        done

        poll_count=$((poll_count + 1))

        # Atualiza pico total
        if [[ "$current_total" -gt "$max_total_rss" ]]; then
            max_total_rss=$current_total
        fi

        # Verifica condicao de saida: todos mortos ou timeout
        if $all_dead; then
            break
        fi

        local elapsed
        elapsed=$(($(date +%s) - start_time))
        if [[ "$elapsed" -gt "$TIMEOUT_PER_SESSION" ]]; then
            echo -e "    ${YELLOW}[AVISO]${NC} Timeout apos ${TIMEOUT_PER_SESSION}s — matando processos restantes..." >&2
            for pid in "${pids[@]}"; do
                kill -9 "$pid" 2>/dev/null || true
            done
            break
        fi

        sleep "$POLL_INTERVAL"
    done

    # Aguarda todos os processos terminarem (ou ja terem sido mortos)
    for pid in "${pids[@]}"; do
        wait "$pid" 2>/dev/null || true
    done

    local elapsed
    elapsed=$(($(date +%s) - start_time))

    # -------------------------------------------------------------------------
    # Fase 3: Analise dos dados coletados
    # -------------------------------------------------------------------------
    local per_pid_peaks=()
    for pid in "${pids[@]}"; do
        local peak
        peak=$(grep " $pid " "$poll_file" 2>/dev/null | awk '{print $3}' | sort -n | tail -1)
        per_pid_peaks+=("${peak:-0}")
    done

    # Calcula estatisticas
    local sum=0
    local min_rss=999999999
    local max_rss=0
    local valid_count=0

    for rss in "${per_pid_peaks[@]}"; do
        if [[ "$rss" -gt 0 ]]; then
            sum=$((sum + rss))
            valid_count=$((valid_count + 1))
            [[ "$rss" -lt "$min_rss" ]] && min_rss=$rss
            [[ "$rss" -gt "$max_rss" ]] && max_rss=$rss
        fi
    done

    local mean_rss=0
    if [[ "$valid_count" -gt 0 ]]; then
        mean_rss=$((sum / valid_count))
    fi

    if [[ "$valid_count" -eq 0 ]]; then
        min_rss=0
        max_rss=0
    fi

    # Verifica se os agentes produziram saida (validacao de sucesso)
    local success_count=0
    for ((i = 0; i < n_agents; i++)); do
        local agent_dir="$agents_dir/agent_${i}"
        if [[ -f "$agent_dir/README.md" ]]; then
            success_count=$((success_count + 1))
        fi
    done

    # Exibe resumo rapido
    echo -e "    ${GREEN}Concluido:${NC} ${n_agents} agentes em ${elapsed}s" >&2
    echo -e "    ${GREEN}Sucesso:${NC}  ${success_count}/${n_agents} agentes criaram README.md" >&2
    echo -e "    ${GREEN}Pico RSS:${NC} $(format_mb "$max_total_rss") total, $(format_mb "$mean_rss") medio/agente" >&2

    # Retorna dados como linha formatada
    echo "${n_agents}|${mean_rss}|${max_total_rss}|${min_rss}|${max_rss}|${elapsed}|${success_count}"
}

# -----------------------------------------------------------------------------
# calculate_marginal — calcula custo marginal entre dois niveis de paralelismo
#
# Argumentos:
#   $1 — RSS total no nivel anterior (KB)
#   $2 — RSS total no nivel atual (KB)
#   $3 — sessoes no nivel anterior
#   $4 — sessoes no nivel atual
#
# Retorna (stdout): custo marginal em KB (RSS adicional por novo agente)
# -----------------------------------------------------------------------------
calculate_marginal() {
    local rss_prev=$1
    local rss_curr=$2
    local sessions_prev=$3
    local sessions_curr=$4

    local delta_sessions=$((sessions_curr - sessions_prev))
    if [[ "$delta_sessions" -le 0 ]]; then
        echo "0"
        return
    fi

    local delta_rss=$((rss_curr - rss_prev))
    if [[ "$delta_rss" -lt 0 ]]; then
        delta_rss=0
    fi

    echo $((delta_rss / delta_sessions))
}

# -----------------------------------------------------------------------------
# estimate_for_10 — projeta consumo estimado para 10 agentes
#
# Usa o custo marginal medio observado para extrapolar.
#
# Argumentos:
#   $1 — RSS total com 5 agentes (KB)
#   $2 — custo marginal medio (KB)
#   $3 — RSS medio por agente com 5 agentes (KB)
#
# Retorna (stdout): RSS total estimado para 10 agentes (KB)
# -----------------------------------------------------------------------------
estimate_for_10() {
    local rss_5=$1
    local marginal_avg=$2
    local mean_5=$3

    # Metodo 1: rss_5 + (marginal_avg * 5)
    local est_method1=$((rss_5 + marginal_avg * 5))

    # Metodo 2: mean_5 * 10 (linear puro)
    local est_method2=$((mean_5 * 10))

    # Usa a media dos dois metodos
    echo $(((est_method1 + est_method2) / 2))
}

# -----------------------------------------------------------------------------
# print_header — imprime cabecalho do relatorio
# -----------------------------------------------------------------------------
print_header() {
    echo ""
    echo -e "${BOLD}$(printf '=%.0s' {1..80})${NC}"
    echo -e "${BOLD}  BENCHMARK DE RAM — Sub-agentes jcode (Projetos Reais)${NC}"
    echo -e "  ${DIM}Modelo: ${MODEL} | Provider: ${PROVIDER_PROFILE}${NC}"
    echo -e "  ${DIM}Tarefa:  Criar README.md com nome de projeto unico${NC}"
    echo -e "  ${DIM}Poll:    ${POLL_INTERVAL}s | Timeout: ${TIMEOUT_PER_SESSION}s${NC}"
    echo -e "  ${DIM}Memory:  JCODE_MEMORY_ENABLED=false (zero embeddings)${NC}"
    echo -e "${BOLD}$(printf '=%.0s' {1..80})${NC}"
    echo ""

    # Memoria do sistema (baseline)
    read -r sys_total sys_used sys_free <<< "$(get_system_memory)"
    echo -e "  ${BOLD}Baseline — Memoria do Sistema:${NC}"
    echo -e "    Total:   $(format_mb "$sys_total")"
    echo -e "    Usada:   $(format_mb "$sys_used")"
    echo -e "    Livre:   $(format_mb "$sys_free")"
    echo ""
}

# -----------------------------------------------------------------------------
# print_results_table — imprime tabela de resultados e comparacao
#
# Argumentos:
#   $1 — string de resultados no formato:
#        "N1:mean1:total1:min1:max1:elapsed1:ok1,N2:mean2:..."
# -----------------------------------------------------------------------------
print_results_table() {
    local results_str="$1"

    # ---- Tabela de RSS por cenario ----
    echo -e "  ${BOLD}Resultados por Cenário de Paralelismo:${NC}"
    echo ""
    printf "  ${BOLD}%-10s %15s %15s %15s %15s %10s${NC}\n" \
        "Agentes" "RSS Médio" "RSS Total" "RSS Mínimo" "RSS Máximo" "Sucesso"
    printf "  %-10s %15s %15s %15s %15s %10s\n" \
        "--------" "---------------" "---------------" "---------------" "---------------" "----------"

    # Ordena resultados por N crescente
    local sorted
    sorted=$(echo "$results_str" | tr ',' '\n' | sort -t'|' -k1 -n)

    local prev_total=0
    local prev_sessions=0
    local marginal_12=0
    local marginal_25=0
    local rss_1=0
    local mean_5=0
    local rss_total_5=0

    while IFS='|' read -r n mean total min_rss max_rss elapsed success; do
        [[ -z "$n" ]] && continue

        printf "  ${CYAN}%-10s${NC} ${GREEN}%15s${NC} ${YELLOW}%15s${NC} ${DIM}%15s${NC} ${DIM}%15s${NC} ${NC}%8s/%-1s${NC}\n" \
            "$n" \
            "$(format_mb "$mean")" \
            "$(format_mb "$total")" \
            "$(format_mb "$min_rss")" \
            "$(format_mb "$max_rss")" \
            "$success" "$n"

        # Guarda RSS da primeira sessao
        if [[ "$n" -eq 1 ]]; then
            rss_1=$total
        fi

        # Guarda metricas de 5 agentes
        if [[ "$n" -eq 5 ]]; then
            mean_5=$mean
            rss_total_5=$total
        fi

        # Calcula custo marginal
        if [[ "$n" -eq 2 ]]; then
            marginal_12=$(calculate_marginal "$prev_total" "$total" "$prev_sessions" "$n")
        elif [[ "$n" -eq 5 ]]; then
            marginal_25=$(calculate_marginal "$prev_total" "$total" "$prev_sessions" "$n")
        fi

        prev_total=$total
        prev_sessions=$n
    done <<< "$sorted"

    echo ""

    # ---- Custo Marginal ----
    echo -e "  ${BOLD}Custo Marginal (RSS adicional por novo agente):${NC}"
    echo ""

    local marginal_sum=0
    local marginal_count=0

    if [[ "$marginal_12" -gt 0 ]]; then
        echo -e "    1 → 2  : ${CYAN}$(format_mb "$marginal_12")${NC} por agente adicional"
        marginal_sum=$((marginal_sum + marginal_12))
        marginal_count=$((marginal_count + 1))
    fi
    if [[ "$marginal_25" -gt 0 ]]; then
        echo -e "    2 → 5  : ${CYAN}$(format_mb "$marginal_25")${NC} por agente adicional"
        marginal_sum=$((marginal_sum + marginal_25))
        marginal_count=$((marginal_count + 1))
    fi

    local marginal_avg=0
    if [[ "$marginal_count" -gt 0 ]]; then
        marginal_avg=$((marginal_sum / marginal_count))
        echo -e "    ${BOLD}Média:  $(format_mb "$marginal_avg")${NC} por agente adicional"
        echo ""
        echo -e "  ${DIM}Interpretacao: cada novo agente paralelo adiciona ~$(format_mb "$marginal_avg") ao RSS total.${NC}"
    fi

    echo ""

    # ---- Estimativa para 10 agentes ----
    if [[ "$rss_total_5" -gt 0 && "$marginal_avg" -gt 0 && "$mean_5" -gt 0 ]]; then
        local est_10
        est_10=$(estimate_for_10 "$rss_total_5" "$marginal_avg" "$mean_5")

        echo -e "  ${BOLD}Projecao para 10 Sub-agentes:${NC}"
        echo ""
        echo -e "    RSS Total Estimado:  ${MAGENTA}$(format_mb "$est_10")${NC}"
        echo -e "    RSS por Agente (est): ${MAGENTA}$(format_mb $((est_10 / 10)))${NC}"
        echo ""
    fi

    # ---- Comparação com benchmarks do t-8000 ----
    echo -e "  ${BOLD}Comparacao com Benchmarks do t-8000:${NC}"
    echo ""

    # Converte nossos valores para MB
    local our_1_mb our_5_mb our_marginal_mb
    our_1_mb=$(awk "BEGIN {printf \"%.1f\", $rss_1 / 1024}")
    our_5_mb=$(awk "BEGIN {printf \"%.1f\", $rss_total_5 / 1024}")
    our_marginal_mb=$(awk "BEGIN {printf \"%.1f\", $marginal_avg / 1024}")

    # Marginais do t-8000
    local ref_marginal_mb
    ref_marginal_mb=$(awk "BEGIN {printf \"%.1f\", (${REF_T8000_5_SESSIONS} - ${REF_T8000_1_SESSION}) / 4}")

    printf "  ${BOLD}%-30s %18s %18s %18s${NC}\n" \
        "Benchmark" "1 Agente (MB)" "5 Agentes (MB)" "Marginal (MB)"
    printf "  %-30s %18s %18s %18s\n" \
        "------------------------------" "------------------" "------------------" "------------------"

    printf "  ${GREEN}%-30s${NC} ${GREEN}%18s${NC} ${GREEN}%18s${NC} ${GREEN}%18s${NC}\n" \
        "jcode sub-agentes (este)" \
        "${our_1_mb}" \
        "${our_5_mb}" \
        "${our_marginal_mb}"

    printf "  ${YELLOW}%-30s${NC} ${YELLOW}%18s${NC} ${YELLOW}%18s${NC} ${YELLOW}%18s${NC}\n" \
        "t-8000 jcode run (~47 MB/sessao)" \
        "${REF_T8000_1_SESSION}" \
        "${REF_T8000_5_SESSIONS}" \
        "${ref_marginal_mb}"

    echo ""
    echo -e "  ${DIM}Nota: O benchmark do t-8000 usa prompt trivial (\"Responda: OK\"),${NC}"
    echo -e "  ${DIM}enquanto este benchmark usa tarefas reais de criacao de arquivos.${NC}"
    echo -e "  ${DIM}A diferenca reflete o custo adicional de operacoes de filesystem.${NC}"
    echo ""

    # ---- Eficiencia relativa ----
    if [[ "$rss_total_5" -gt 0 ]]; then
        echo -e "  ${BOLD}Eficiencia vs t-8000 (5 agentes/sessoes):${NC}"
        echo ""

        local our_5_total_mb
        our_5_total_mb=$(awk "BEGIN {printf \"%.1f\", $rss_total_5 / 1024}")
        local ratio
        ratio=$(awk "BEGIN {printf \"%.1f\", ${REF_T8000_5_SESSIONS} / $our_5_total_mb}")

        if (( $(awk "BEGIN {print ($our_5_total_mb > ${REF_T8000_5_SESSIONS})}") )); then
            local overhead_pct
            overhead_pct=$(awk "BEGIN {printf \"%.0f\", (($our_5_total_mb - ${REF_T8000_5_SESSIONS}) / ${REF_T8000_5_SESSIONS}) * 100}")
            echo -e "    ${YELLOW}Sub-agentes consomem ${overhead_pct}% mais RAM que sessoes triviais${NC}"
            echo -e "    ${DIM}(esperado: tarefas de filesystem tem custo adicional de I/O)${NC}"
        else
            echo -e "    ${GREEN}Sub-agentes consomem ${ratio}x menos RAM que sessoes triviais${NC}"
        fi
    fi
}

# -----------------------------------------------------------------------------
# print_footer — imprime rodape do relatorio
# -----------------------------------------------------------------------------
print_footer() {
    echo ""
    echo -e "${BOLD}$(printf '=%.0s' {1..80})${NC}"
    echo -e "  ${GREEN}${BOLD}BENCHMARK DE SUB-AGENTES COMPLETO${NC}"
    echo -e "${BOLD}$(printf '=%.0s' {1..80})${NC}"
    echo ""
}

# -----------------------------------------------------------------------------
# cleanup — handler de saida: mata processos jcode orfaos e limpa temp dirs
# -----------------------------------------------------------------------------
cleanup() {
    local exit_code=$?

    # Limpa diretorios temporarios rastreados
    for td in "${_TEMP_DIRS[@]}"; do
        rm -rf "$td" 2>/dev/null || true
    done

    # Mata qualquer processo jcode residual lancado por este script
    local orphans
    orphans=$(ps -eo pid,comm 2>/dev/null | grep "[j]code" | awk '{print $1}' || true)
    if [[ -n "$orphans" ]]; then
        for pid in $orphans; do
            kill -9 "$pid" 2>/dev/null || true
        done
    fi

    exit $exit_code
}

# -----------------------------------------------------------------------------
# parse_args — parseia argumentos da linha de comando
# -----------------------------------------------------------------------------
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model)
                MODEL="${2:?Erro: --model requer um valor}"
                shift 2
                ;;
            --provider-profile)
                PROVIDER_PROFILE="${2:?Erro: --provider-profile requer um valor}"
                shift 2
                ;;
            --max-parallel)
                MAX_PARALLEL="${2:?Erro: --max-parallel requer um valor}"
                if ! [[ "$MAX_PARALLEL" =~ ^[0-9]+$ ]] || [[ "$MAX_PARALLEL" -lt 1 ]]; then
                    echo -e "${RED}[ERRO]${NC} --max-parallel deve ser um inteiro positivo" >&2
                    exit 1
                fi
                shift 2
                ;;
            --help|-h)
                usage
                exit 0
                ;;
            *)
                echo -e "${RED}[ERRO]${NC} Argumento desconhecido: $1" >&2
                echo "  Use --help para documentacao." >&2
                exit 1
                ;;
        esac
    done
}

# -----------------------------------------------------------------------------
# main — ponto de entrada
# -----------------------------------------------------------------------------
main() {
    # Configura trap para cleanup ao sair
    trap cleanup EXIT INT TERM

    parse_args "$@"

    print_header

    # Verifica dependencias
    check_dependencies

    echo -e "  ${BOLD}Iniciando benchmark com ${#TEST_SESSIONS[@]} cenarios...${NC}"
    echo -e "  ${DIM}(Este processo pode levar varios minutos — cada agente cria um projeto real)${NC}"
    echo ""

    # Coleciona resultados de todos os testes
    local all_results=""

    for n in "${TEST_SESSIONS[@]}"; do
        # Pula cenarios alem do max-parallel
        if [[ "$n" -gt "$MAX_PARALLEL" ]]; then
            echo -e "  ${YELLOW}[SKIP]${NC} $n agentes (max-parallel=$MAX_PARALLEL)" >&2
            continue
        fi

        echo -e "  ${BOLD}--- $n sub-agente(s) paralelo(s) ---${NC}" >&2

        local result
        result=$(run_parallel_test "$n")

        # Acumula resultado
        if [[ -n "$all_results" ]]; then
            all_results="${all_results},${result}"
        else
            all_results="${result}"
        fi
    done

    echo ""

    # Imprime tabela de resultados
    print_results_table "$all_results"

    print_footer

    return 0
}

# -----------------------------------------------------------------------------
# Invocacao
# -----------------------------------------------------------------------------
main "$@"
