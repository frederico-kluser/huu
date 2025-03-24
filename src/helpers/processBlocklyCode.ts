/**
 * Processa uma estrutura blockly para separar blocos de navegação e seus códigos subsequentes.
 * Retorna um objeto contendo a estrutura original, código inicial antes da navegação,
 * e segmentos de código que incluem cada bloco de navegação e os blocos subsequentes.
 *
 * @param {any} workspaceBlockData - A estrutura blockly a ser processada
 * @returns {any} Um objeto contendo a estrutura original e segmentos de código organizados
 */
const processBlocklyCode = (workspaceBlockData: any): any => {
  const result: any = {
    original: workspaceBlockData,
  };

  const navigationBlockTypes = [
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
    findNavigationSegments(workspaceClone.blocks.blocks[0], result, navigationBlockTypes);
  }

  // Adiciona a estrutura inicial (até encontrar blocos de navegação)
  result.initial = getCodeUntilNavigation(
    JSON.parse(JSON.stringify(workspaceBlockData)),
    navigationBlockTypes,
  );

  return result;
};

/**
 * Encontra recursivamente blocos de navegação e extrai os segmentos de código que incluem
 * o próprio bloco de navegação e seus blocos subsequentes.
 *
 * @param {any} block - O bloco a ser processado
 * @param {any} result - O objeto de resultado sendo construído
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 */
const findNavigationSegments = (
  block: any,
  result: any,
  navigationBlockTypes: string[],
): void => {
  if (!block) return;

  // Verifica se este é um bloco de navegação
  if (navigationBlockTypes.includes(block.type)) {
    // Clona o bloco de navegação para preservá-lo com seu código subsequente
    const navigationBlock = JSON.parse(JSON.stringify(block));
    if (navigationBlock.next) {
      result[block.id] = navigationBlock.next;
    }
  }

  // Processa inputs (para blocos aninhados)
  if (block.inputs) {
    Object.entries(block.inputs).forEach(([inputName, input]: [string, any]) => {
      if (input.block) {
        findNavigationSegments(input.block, result, navigationBlockTypes);
      }
    });
  }

  // Processa blocos seguintes
  if (block.next?.block) {
    findNavigationSegments(block.next.block, result, navigationBlockTypes);
  }
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