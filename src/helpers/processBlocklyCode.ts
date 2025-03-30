import { block } from "blockly/core/tooltip";
import { TypeBlock } from "../types/agent";

type TypeProcessBlocklyCode = {
  original: any;
  navigation: TypeBlock;
  initial: any;
};

/**
 * Processa uma estrutura blockly para separar blocos de navegação e seus códigos subsequentes.
 * Retorna um objeto contendo a estrutura original, código inicial antes da navegação,
 * e segmentos de código que incluem cada bloco de navegação e os blocos subsequentes.
 *
 * @param {any} workspaceBlockData - A estrutura blockly a ser processada
 * @returns {any} Um objeto contendo a estrutura original e segmentos de código organizados
 */
const processBlocklyCode = (workspaceBlockData: any): TypeProcessBlocklyCode => {
  const result: any = {
    original: workspaceBlockData,
    navigation: {},
    initial: null,
  };

  const navigationBlockTypes = [
    'BlockNavigate',
    'BlockNavigateToUrlText',
    'BlockNavigateBack',
    'BlockNavigateForward',
    'BlockRefreshPage',
    'BlockNavigateRefresh', // Incluindo ambas as variantes
  ];

  // Clone a estrutura para evitar modificar o original
  const workspaceClone = JSON.parse(JSON.stringify(workspaceBlockData));

  // Extrai todos os segmentos de navegação (incluindo o próprio bloco de navegação)
  if (workspaceClone.blocks.blocks.length > 0) {
    result.navigation = extractNavigationPaths(workspaceClone.blocks.blocks[0], result, navigationBlockTypes);
    console.log('extractNavigationPaths(workspaceClone.blocks.blocks[0], result, navigationBlockTypes)', workspaceClone.blocks.blocks[0], result, navigationBlockTypes);
  }

  /*
    procedures_defnoreturn
    procedures_callnoreturn
  */

  // Adiciona a estrutura inicial (até encontrar blocos de navegação)
  result.initial = getCodeUntilNavigation(
    JSON.parse(JSON.stringify(workspaceBlockData)),
    navigationBlockTypes,
  );

  console.log("result.initial", result.initial);
  console.log("result.navigation", result.navigation);

  return injectNavigationFunctions(result);
};

const injectNavigationFunctions = (result: any) => {
  const resultClone = JSON.parse(JSON.stringify(result));

  Object.entries(resultClone.navigation).forEach(([key, value]: [string, any]) => {
    const cloneInitial = JSON.parse(JSON.stringify(resultClone.initial));
    cloneInitial.blocks.blocks = [value.block];
    resultClone.navigation[key] = cloneInitial;
  });

  return resultClone;
};

/**
 * Encontra recursivamente blocos de navegação e extrai os segmentos de código que incluem
 * o próprio bloco de navegação e seus blocos subsequentes.
 *
 * @param {any} block - O bloco a ser processado
 * @param {any} result - O objeto de resultado sendo construído
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 */
const extractNavigationPaths = (
  blocks: any,
  result: any,
  navigationBlockTypes: string[],
): TypeBlock => {
  var navigationClone: TypeBlock = result.navigation || {};

  // Função auxiliar para processar a estrutura de blocos
  const processBlockStructure = (blocksToProcess: any): void => {
    // Verifica se 'blocks' está na estrutura esperada
    if (blocksToProcess?.original?.blocks?.blocks) {
      // Processa os blocos em original
      processBlocks(blocksToProcess.original.blocks.blocks);
    }

    // Se não estiver em uma estrutura aninhada, tenta processar diretamente
    if (Array.isArray(blocksToProcess)) {
      processBlocks(blocksToProcess);
    } else if (blocksToProcess && typeof blocksToProcess === 'object') {
      processBlock(blocksToProcess);
    }
  };

  // Processa uma lista de blocos
  const processBlocks = (blocksList: any[]): void => {
    if (Array.isArray(blocksList)) {
      blocksList.forEach(block => processBlock(block));
    }
  };

  // Processa um único bloco e seus filhos recursivamente
  const processBlock = (block: any): void => {
    if (!block || typeof block !== 'object') return;

    // Verifica se é um bloco de navegação
    if (block.type && navigationBlockTypes.includes(block.type)) {
      if (block.next) {
        navigationClone[block.id] = block.next;
      }
    }

    // Processa inputs (para blocos aninhados)
    if (block.inputs) {
      Object.values(block.inputs).forEach((input: any) => {
        if (input && input.block) {
          processBlock(input.block);
        }
      });
    }

    // Processa o próximo bloco
    if (block.next && block.next.block) {
      processBlock(block.next.block);
    }
  };

  // Inicia o processamento
  processBlockStructure(blocks);

  // Também processa a estrutura result se for diferente de blocks
  if (blocks !== result) {
    processBlockStructure(result);
  }

  return navigationClone;
};

/**
 * Processa o workspace para obter apenas o código até encontrar um bloco de navegação.
 * Preserva a estrutura até os blocos de navegação, mas interrompe os caminhos nestes blocos.
 *
 * @param {any} workspace - O workspace a ser processado
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 * @returns {any} O workspace modificado contendo apenas o código até os blocos de navegação
 */
const getCodeUntilNavigation = (
  workspace: any,
  navigationBlockTypes: string[],
): any => {
  // Processa cada bloco de nível superior
  if (workspace.blocks.blocks.length > 0) {
    workspace.blocks.blocks.forEach((block: any) => {
      processUntilNavigation(block, null, navigationBlockTypes);
    });
  }

  return workspace;
};

/**
 * Processa recursivamente a estrutura de blocos, preservando o caminho até 
 * encontrar blocos de navegação, onde interrompe a recursão.
 *
 * @param {any} block - O bloco a ser processado
 * @param {any} parent - O bloco pai (se houver)
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 * @param {string | null} parentInputName - O nome do input no pai (se houver)
 */
const processUntilNavigation = (
  block: any,
  parent: any,
  navigationBlockTypes: string[],
  parentInputName: string | null = null,
): void => {
  if (!block) return;

  // Se este é um bloco de navegação, preserva o bloco mas remove seus blocos subsequentes
  if (navigationBlockTypes.includes(block.type)) {
    // Preserva o bloco de navegação, mas remove seus blocos subsequentes
    block.next = null;
    return; // Para de processar este ramo
  }

  // Processa inputs (para blocos aninhados)
  if (block.inputs) {
    Object.entries(block.inputs).forEach(([inputName, input]: [string, any]) => {
      if (input.block) {
        processUntilNavigation(input.block, block, navigationBlockTypes, inputName);
      }
    });
  }

  // Processa blocos seguintes
  if (block.next?.block) {
    processUntilNavigation(block.next.block, block, navigationBlockTypes);
  }
};

export default processBlocklyCode;