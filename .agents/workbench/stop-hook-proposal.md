# Proposta (opcional): hook Stop para tornar o passo de evolução determinístico

> **SUPERADA (2026-09-27).** O passo `<evolution>` e o `check-pending-evolution.sh`
> foram apagados na centralização da memória no CoALA: o aprendizado durável agora é
> um `coala.py add` no fim de cada tarefa (`<aprender>`). Mantida só como histórico —
> a sentinela consumível em si continua sendo um padrão válido se um dia voltar a ser
> preciso (agora apontando a passos `<aprender>` pendentes).

> Fase 4 do sistema de skills · 2026-06-12 · NÃO habilitado por padrão — decisão do humano.

## Problema

O passo `<evolution>` das skills de tarefa depende de o agente lembrar de executá-lo.
Um hook `Stop` torna o esquecimento impossível: a sessão não encerra enquanto houver
evoluções pendentes.

## Mecanismo (sentinela consumível — mesmo padrão do `killedAgentIds`)

1. O `project-router`, ao montar uma cadeia com skills de tarefa, escreve
   `.agents/workbench/.pending-evolution` (um nome de skill por linha).
2. Cada passo `<evolution>` concluído remove a sua linha.
3. O hook Stop roda `check-pending-evolution.sh`; se o arquivo tem conteúdo,
   bloqueia o encerramento com a lista do que falta. Arquivo vazio/ausente → libera.
4. Escape hatch humano: deletar o arquivo libera imediatamente.

## Como habilitar

Adicionar ao `.claude/settings.json` (ou `settings.local.json`) do repo:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash .agents/skills/project-router/scripts/check-pending-evolution.sh"
          }
        ]
      }
    ]
  }
}
```

O script já existe em `.agents/skills/project-router/scripts/check-pending-evolution.sh`
e o protocolo do router já contém o passo opcional de escrever a sentinela
("Optional (only when the Stop-hook integration is enabled)").

## Trade-off

- ✅ Evolução nunca é esquecida; determinístico, não depende do modelo.
- ⚠ Se o agente falhar no meio da cadeia, o humano precisa deletar a sentinela
  (comportamento desejado: força o olhar humano sobre a cadeia interrompida).
