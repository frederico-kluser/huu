# Política de Segurança

> **English version:** [SECURITY.en.md](SECURITY.en.md)

O `huu` executa agentes de LLM com acesso ao seu repositório e às suas
credenciais de provedor — segurança é parte do produto, não um apêndice.
Obrigado por ajudar a mantê-lo seguro.

## Versões suportadas

| Versão | Suporte |
|---|---|
| Última publicada (`huu-pipe` no npm / `ghcr.io/frederico-kluser/huu` no GHCR) | ✅ Correções de segurança |
| Versões anteriores | ❌ Atualize para a última |

Recomendação: fixe uma tag de imagem (`HUU_IMAGE`) para builds
reprodutíveis, mas acompanhe as correções de segurança na linha de
release atual.

## Como relatar uma vulnerabilidade

**Nunca abra uma issue pública para uma vulnerabilidade.** Escolha um
dos canais privados:

1. **GitHub Security Advisories** (preferido): aba *Security* →
   *Report a vulnerability* — o relato é privado e chega direto ao
   mantenedor.
2. **E-mail:** [kluserhuu@gmail.com](mailto:kluserhuu@gmail.com) com o
   assunto `[SECURITY] <resumo curto>`.

Inclua no relato:

- Descrição do impacto e do vetor (como um atacante chegaria lá).
- Passos de reprodução ou PoC **sem dados reais**: nunca cole chaves de
  API, tokens, segredos de terceiros ou dados de clientes — descreva-os
  (`um token OpenRouter no formato sk-or-…`) em vez de reproduzi-los.
- Versão afetada (`npm view huu-pipe version` / tag da imagem) e
  ambiente (SO, Docker ou nativo).

## O que esperar depois do relato

- **Confirmação** em até 7 dias, com uma avaliação inicial.
- **Diálogo** sobre o impacto e a correção; você recebe crédito no
  `CHANGELOG.md` se quiser (ou relato anônimo).
- **Divulgação coordenada**: o embargo padrão é de até 90 dias, ou
  antes se a correção for publicada antes disso. Depois da correção,
  publicamos os detalhes.

## Escopo

- O runner (`src/`, `scripts/`, `Dockerfile`, imagem GHCR) e o pacote
  npm `huu-pipe`.
- O **tratamento de credenciais**: registro de chaves
  (`src/lib/api-key-registry.ts`), secret-mounts do Docker, scrubbing de
  segredos em logs/transcripts, isolamento do ambiente do subprocesso.
- Os workflows de CI deste repositório.

## Fora de escopo

Fora de escopo (obrigado por não abrir relatos de segurança para eles):

- **Saídas de modelos**: conteúdo gerado por LLMs (código, texto,
  alucinações) — responsabilidade do modelo e do revisor humano.
- **Conteúdo de pipelines de terceiros**: pipelines que você escreveu ou
  instalou são seus; revise-os antes de rodar.
- **Provedores externos**: vulnerabilidades em DeepSeek, OpenRouter ou
  GitHub devem ser reportadas aos respectivos responsáveis.
- **Má configuração do usuário**: chaves commitadas no seu repositório,
  `--no-docker` em ambiente sensível, permissões do seu runner.

## Credenciais no uso do huu

- As chaves entram por variáveis de ambiente (`DEEPSEEK_API_KEY`,
  `OPENROUTER_API_KEY` ou o sufixo `_FILE` apontando para um ficheiro) e
  montam-se no container como secret-mounts — nunca vão para comandos em
  argv nem para o prompt de um agente.
- Cada run gasta **exatamente uma** chave — a do provedor ativo; as
  chaves dos outros provedores são removidas do ambiente do subprocesso.
- Se a sua chave vazou: **rotacione-a primeiro** no provedor
  (openrouter.ai/settings/keys · plataforma DeepSeek) e depois avise-nos
  se o vazamento veio do huu.

Uma nota final: o `huu` manda prompts a modelos e escreve no seu repo
por desenho. Trate os pipelines que roda com o mesmo cuidado que trata
qualquer código de terceiros.
