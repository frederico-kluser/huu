import { TypeBlock } from "../types/agent";

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

export default extractNavigationPaths;