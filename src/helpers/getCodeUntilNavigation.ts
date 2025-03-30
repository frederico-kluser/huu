
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

export default getCodeUntilNavigation;