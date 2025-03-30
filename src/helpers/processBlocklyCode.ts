import { block } from "blockly/core/tooltip";
import { TypeBlock } from "../types/agent";
import extractNavigationPaths from "./extractNavigationPaths";
import getCodeUntilNavigation from "./getCodeUntilNavigation";
import injectNavigationFunctions from "./injectNavigationFunctions";

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

  // Adiciona a estrutura inicial (até encontrar blocos de navegação)
  result.initial = getCodeUntilNavigation(
    JSON.parse(JSON.stringify(workspaceBlockData)),
    navigationBlockTypes,
  );

  return injectNavigationFunctions(result);
};

export default processBlocklyCode;