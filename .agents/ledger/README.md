# Ledger de incerteza

Ledger de questões em aberto sobre o `huu` — toda suposição que o código não
responde e que afeta decisões de projeto vive aqui, com o teste executável que
a fecha.

**Regra de ouro:** avançar o máximo possível com o que o repositório responde,
e deixar **ABERTO** — nunca resolver por palpite — tudo o que só o ambiente
real, o dono do produto ou uma medição futura pode responder.

## Estados

| Estado | Significado |
|---|---|
| `ABERTO` | A pergunta não tem resposta verificável. Os campos de contexto são obrigatórios; `evidencia` e `data_resolucao` são vazios. |
| `FECHADO` | Respondido com evidência citável. `evidencia` contém referência verificável (URL, `arquivo:linha`, hash de commit) e `data_resolucao` está em ISO 8601. |
| `INVIAVEL` | A pergunta não pode ser respondida com os meios disponíveis. Exige justificativa e referência a ADR quando aplicável. |

## Formato do item

Cada item vive em `.agents/ledger/items/HU-nnn.json`:

```json
{
  "id": "HU-345",
  "pergunta": "Pergunta que o código não responde",
  "por_que_aberto": "Por que o repositório não basta para responder",
  "decisao_provisoria": "O que se assumiu enquanto a resposta não chega",
  "verificacao": "Comando ou procedimento executável que fecha este item",
  "impacto_se_divergir": "O que quebra ou precisa ser refeito se a resposta for outra",
  "status": "ABERTO",
  "evidencia": "",
  "data_resolucao": ""
}
```

### Campos

| Campo | Obrigatório em | Descrição |
|---|---|---|
| `id` | sempre | Identificador único `HU-nnn`. IDs nunca são reciclados. |
| `pergunta` | sempre | A pergunta que o código não responde. Específica, não retórica. |
| `por_que_aberto` | `ABERTO` | Por que o repositório, testes ou documentação não bastam para responder. |
| `decisao_provisoria` | `ABERTO` | Premissa assumida enquanto o item segue aberto. |
| `verificacao` | `ABERTO` | Teste ou procedimento executável que fecha o item. |
| `impacto_se_divergir` | `ABERTO` | Consequência concreta se a decisão provisória estiver errada. |
| `status` | sempre | `ABERTO`, `FECHADO` ou `INVIAVEL`. |
| `evidencia` | `FECHADO` | Referência verificável: URL, `arquivo:linha`, hash de commit, saída de comando. |
| `data_resolucao` | `FECHADO` | Data ISO 8601 (`YYYY-MM-DD`) em que o item foi fechado. |

### Regras de validação

1. **Item ABERTO**: `pergunta`, `por_que_aberto`, `decisao_provisoria`, `verificacao` e
   `impacto_se_divergir` não podem ser strings vazias. `evidencia` e `data_resolucao`
   DEVEM ser strings vazias.

2. **Item FECHADO**: `evidencia` tem de conter referência citável (regex de forma:
   URL, `caminho:linha`, hash hexadecimal ≥7 chars, ou saída de comando entre crases).
   `data_resolucao` tem de ser data ISO 8601 válida (`YYYY-MM-DD`).

3. **Lista negra de evidência**: as strings `"ok"`, `"conferido"`, `"conforme combinado"`
   (case-insensitive, como valor inteiro do campo) são rejeitadas em qualquer status.
   "CONFIRMADO sem evidência anexada é pior que ABERTO."

4. **Âncoras no código**: toda ocorrência de `// ABERTO HU-nnn` em `src/` e `scripts/`
   tem de corresponder a um item existente no ledger com status `ABERTO`.

### Validação

```bash
npx tsx scripts/validate-ledger.ts
```

## Faixas de ID

Conforme `METODO.md` §5.3. IDs nunca são reciclados — o número é citado no
código (`// ABERTO HU-nnn`).

```
M4-01..04: HU-190..229
```

Os itens inaugurais HU-345–HU-348 (do `METODO.md` §9.3) usam uma faixa
estendida para itens que cruzam múltiplas ondas.
