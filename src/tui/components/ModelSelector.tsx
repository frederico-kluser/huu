// Seletor de modelo reutilizável com filtro de texto e lista completa de modelos.
// Usado tanto no SetupWizard quanto no ConfigScreen para seleção de LLM por agente.

import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import {
  getAllModelsForRole,
  getDefaultModelForRole,
  isModelRecommendedForRole,
  formatModelOption,
} from '../../models/catalog.js';
import type { AgentRole, CostBenefitScore } from '../../models/catalog.js';

interface ModelSelectorProps {
  /** Papel do agente para o qual selecionar modelo */
  role: AgentRole;
  /** Callback quando um modelo é selecionado */
  onSelect: (modelId: string) => void;
  /** Se o componente está ativo (captura input) */
  isActive?: boolean;
}

// Altura máxima da lista visível (linhas)
const MAX_VISIBLE = 12;

export function ModelSelector({
  role,
  onSelect,
  isActive = true,
}: ModelSelectorProps): React.JSX.Element {
  const [filter, setFilter] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(-1); // -1 = auto-resolve on first render
  const [isFiltering, setIsFiltering] = useState(false);

  const defaultModelId = getDefaultModelForRole(role);
  const allModels = useMemo(() => getAllModelsForRole(role), [role]);

  // Filtra modelos pela busca
  const filteredModels = useMemo(() => {
    if (!filter.trim()) return allModels;
    const lower = filter.toLowerCase();
    return allModels.filter((s: CostBenefitScore) =>
      s.model.name.toLowerCase().includes(lower) ||
      s.model.provider.toLowerCase().includes(lower) ||
      s.model.id.toLowerCase().includes(lower),
    );
  }, [allModels, filter]);

  // Resolve índice inicial no modelo recomendado
  const resolvedIdx = useMemo(() => {
    if (selectedIdx >= 0) return Math.min(selectedIdx, filteredModels.length - 1);
    // Encontra o modelo padrão na lista filtrada
    const defaultIdx = filteredModels.findIndex((s: CostBenefitScore) => s.model.id === defaultModelId);
    return defaultIdx >= 0 ? defaultIdx : 0;
  }, [selectedIdx, filteredModels, defaultModelId]);

  // Scroll offset para manter item selecionado visível
  const scrollOffset = useMemo(() => {
    if (filteredModels.length <= MAX_VISIBLE) return 0;
    const halfVisible = Math.floor(MAX_VISIBLE / 2);
    if (resolvedIdx <= halfVisible) return 0;
    if (resolvedIdx >= filteredModels.length - halfVisible) {
      return Math.max(0, filteredModels.length - MAX_VISIBLE);
    }
    return resolvedIdx - halfVisible;
  }, [resolvedIdx, filteredModels.length]);

  const visibleModels = filteredModels.slice(scrollOffset, scrollOffset + MAX_VISIBLE);

  // Encontra o índice do primeiro modelo recomendado entre os incompatíveis
  const firstNonRecommendedIdx = useMemo(() => {
    return filteredModels.findIndex((s: CostBenefitScore) => !isModelRecommendedForRole(s.model.id, role));
  }, [filteredModels, role]);

  useInput((input: string, key: { escape: boolean; return: boolean; upArrow: boolean; downArrow: boolean }) => {
    if (!isActive) return;

    // Toggle modo de filtro com '/'
    if (input === '/' && !isFiltering) {
      setIsFiltering(true);
      setFilter('');
      return;
    }

    // Em modo de filtro, Escape sai do filtro
    if (isFiltering) {
      if (key.escape) {
        setIsFiltering(false);
        setFilter('');
        setSelectedIdx(-1);
        return;
      }
      // Enter confirma seleção mesmo durante filtro
      if (key.return && filteredModels.length > 0) {
        const selected = filteredModels[resolvedIdx];
        if (selected) {
          setIsFiltering(false);
          setFilter('');
          onSelect(selected.model.id);
        }
        return;
      }
      // Navegação durante filtro
      if (key.upArrow) {
        setSelectedIdx(Math.max(0, resolvedIdx - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIdx(Math.min(filteredModels.length - 1, resolvedIdx + 1));
        return;
      }
      return;
    }

    // Navegação normal
    if (key.upArrow) {
      setSelectedIdx(Math.max(0, resolvedIdx - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIdx(Math.min(filteredModels.length - 1, resolvedIdx + 1));
      return;
    }
    if (key.return && filteredModels.length > 0) {
      const selected = filteredModels[resolvedIdx];
      if (selected) {
        onSelect(selected.model.id);
      }
      return;
    }
  }, { isActive });

  return (
    <Box flexDirection="column">
      {/* Legenda e cabeçalho da tabela */}
      <Box flexDirection="column">
        <Text dimColor>
          {'\u2605'} = recomendado  |  Classificado por custo-benefício (SWE-Bench / custo)
        </Text>
        <Text dimColor bold>
          {'    '}{'Modelo'.padEnd(22)} {'SWE-B'.padStart(6)}  {'Entrada'.padStart(6)}/{'Saída'.padEnd(7)}  {'  Ctx'.padStart(5)}  {'Razão'.padStart(5)}  {'Avaliação'}
        </Text>
        <Text dimColor>
          {'    '}{'─'.repeat(22)} {'─'.repeat(6)}  {'─'.repeat(14)}  {'─'.repeat(5)}  {'─'.repeat(5)}  {'─'.repeat(10)}
        </Text>
      </Box>

      {/* Lista de modelos */}
      <Box flexDirection="column">
        {scrollOffset > 0 && (
          <Text dimColor>    {'↑'.padEnd(22)} mais {scrollOffset} acima</Text>
        )}
        {visibleModels.map((scored: CostBenefitScore, visIdx: number) => {
          const actualIdx = scrollOffset + visIdx;
          const isSelected = actualIdx === resolvedIdx;
          const isRecommended = isModelRecommendedForRole(scored.model.id, role);
          const showSeparator = actualIdx === firstNonRecommendedIdx && firstNonRecommendedIdx > 0;

          return (
            <React.Fragment key={scored.model.id}>
              {showSeparator && (
                <Text dimColor>    {'─'.repeat(22)} outros modelos {'─'.repeat(30)}</Text>
              )}
              <Text
                color={isSelected ? 'cyan' : isRecommended ? 'white' : 'gray'}
                bold={isSelected}
              >
                {isSelected ? ' \u276F ' : '   '}
                {formatModelOption(scored, defaultModelId)}
              </Text>
            </React.Fragment>
          );
        })}
        {scrollOffset + MAX_VISIBLE < filteredModels.length && (
          <Text dimColor>    {'↓'.padEnd(22)} mais {filteredModels.length - scrollOffset - MAX_VISIBLE} abaixo</Text>
        )}
      </Box>

      {/* Campo de filtro */}
      <Box marginTop={1}>
        {isFiltering ? (
          <Box>
            <Text color="yellow" bold>Filtro: </Text>
            <TextInput
              value={filter}
              onChange={(v: string) => { setFilter(v); setSelectedIdx(0); }}
              placeholder="digite para filtrar modelos..."
            />
          </Box>
        ) : (
          <Text dimColor>[/] Filtrar  [{'\u2191\u2193'}] Navegar  [Enter] Selecionar</Text>
        )}
      </Box>
    </Box>
  );
}
