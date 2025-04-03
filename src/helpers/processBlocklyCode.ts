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
 * Aprimorado para garantir que todas as funções necessárias sejam injetadas nas navegações.
 *
 * @param {any} workspaceBlockData - A estrutura blockly a ser processada
 * @returns {any} Um objeto contendo a estrutura original e segmentos de código organizados
 */
const processBlocklyCode = (workspaceBlockData: any): TypeProcessBlocklyCode => {
  if (!workspaceBlockData.blocks) {
    throw new Error('Invalid workspace block data');
  }

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

  console.log('workspaceClone', workspaceClone);

  // Extrai todos os segmentos de navegação (incluindo o próprio bloco de navegação e blocos subsequentes)
  if (workspaceClone.blocks.blocks.length > 0) {
    // Percorre todos os blocos de nível superior para capturar todas as navegações possíveis
    workspaceClone.blocks.blocks.forEach((topBlock: any) => {
      const navigationPaths = extractNavigationPaths(topBlock, result, navigationBlockTypes);
      // Mescla os resultados no objeto navigation principal
      result.navigation = { ...result.navigation, ...navigationPaths };
    });
    
    console.log('Extracted navigation paths:', result.navigation);
  }

  // Adiciona a estrutura inicial (até encontrar blocos de navegação)
  result.initial = getCodeUntilNavigation(
    JSON.parse(JSON.stringify(workspaceBlockData)),
    navigationBlockTypes,
  );

  // Injeta todas as funções necessárias em cada segmento de navegação
  // incluindo funções dependentes chamadas após a navegação
  const processedResult = injectNavigationFunctions(result);
  
  console.log('Processed navigation functions:', processedResult.navigation);
  
  return processedResult;
};

export default processBlocklyCode;