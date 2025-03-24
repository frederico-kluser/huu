/**
 * Processa uma estrutura blockly para separar blocos de navegação e seus códigos subsequentes.
 * Retorna um objeto contendo a estrutura original, código inicial antes da navegação,
 * e segmentos de código que seguem cada bloco de navegação.
 *
 * @param {any} blocklyWorkspace - A estrutura blockly a ser processada
 * @returns {any} Um objeto contendo a estrutura original e segmentos de código organizados
 */
const processBlocklyCode = (blocklyWorkspace: any): any => {
  const result: any = {
    original: blocklyWorkspace,
  };

  const navigationBlockTypes = [
    'BlockNavigateToUrlText',
    'BlockNavigateBack',
    'BlockNavigateForward',
    'BlockRefreshPage',
    'BlockNavigateRefresh', // Incluindo ambas as variantes
  ];

  // Clone a estrutura para evitar modificar o original
  const workspaceClone = JSON.parse(JSON.stringify(blocklyWorkspace));

  // Extrai todos os segmentos de navegação
  if (workspaceClone.blocks.blocks.length > 0) {
    findNavigationSegments(workspaceClone.blocks.blocks[0], result, navigationBlockTypes);
  }

  // Adiciona a estrutura inicial (sem blocos de navegação)
  result.initial = removeNavigationBlocks(
    JSON.parse(JSON.stringify(blocklyWorkspace)),
    navigationBlockTypes,
  );

  return result;
};

/**
 * Encontra recursivamente blocos de navegação e extrai os segmentos de código subsequentes.
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
    // Extrai o segmento após este bloco de navegação
    if (block.next?.block) {
      result[block.id] = block.next.block;
    } else {
      result[block.id] = null;
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
 * Remove blocos de navegação e seus segmentos subsequentes de um workspace.
 *
 * @param {any} workspace - O workspace a ser processado
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 * @returns {any} O workspace modificado
 */
const removeNavigationBlocks = (
  workspace: any,
  navigationBlockTypes: string[],
): any => {
  // Processa cada bloco de nível superior
  if (workspace.blocks.blocks.length > 0) {
    workspace.blocks.blocks.forEach((block: any) => {
      cleanupNavigationBlocks(block, null, navigationBlockTypes);
    });
  }

  return workspace;
};

/**
 * Remove recursivamente blocos de navegação de uma estrutura de blocos.
 *
 * @param {any} block - O bloco a ser processado
 * @param {any} parent - O bloco pai (se houver)
 * @param {string[]} navigationBlockTypes - Array de tipos de blocos considerados como navegação
 * @param {string | null} parentInputName - O nome do input no pai (se houver)
 */
const cleanupNavigationBlocks = (
  block: any,
  parent: any,
  navigationBlockTypes: string[],
  parentInputName: string | null = null,
): void => {
  if (!block) return;

  // Verifica se este é um bloco de navegação
  if (navigationBlockTypes.includes(block.type)) {
    // Remove este bloco de navegação do seu pai
    if (parent && parentInputName) {
      // Para inputs (como IF_BRANCH, ELSE_BRANCH)
      parent.inputs[parentInputName].block = null;
    } else if (parent) {
      // Para blocos seguintes
      parent.next = null;
    }
    return; // Para de processar este ramo
  }

  // Processa inputs (para blocos aninhados)
  if (block.inputs) {
    Object.entries(block.inputs).forEach(([inputName, input]: [string, any]) => {
      if (input.block) {
        cleanupNavigationBlocks(input.block, block, navigationBlockTypes, inputName);
      }
    });
  }

  // Processa blocos seguintes
  if (block.next?.block) {
    cleanupNavigationBlocks(block.next.block, block, navigationBlockTypes);
  }
};

export default processBlocklyCode;