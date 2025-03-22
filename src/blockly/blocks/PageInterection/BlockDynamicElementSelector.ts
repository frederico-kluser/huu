import * as Blockly from 'blockly/core';
import blockConstructor from '../../helpers/blockConstructor';
import Colors from '../../config/colors';
import BlocklyTypes from '../../config/types';
import { Order } from 'blockly/javascript';
import { BlocklyEvent } from '../../types/blockEvent';
import { setElementSelection } from '../../../core/storage/elementSelection';
import { fetchActualWorkspaceIndex, fetchActualWorkspaceName, fetchWorkspaceNames } from '../../../core/storage/workspace';

const blockName = 'BlockDynamicElementSelector';

const setBlockDynamicElementSelector = () => {
    // Registramos o tipo de bloco usando nosso constructor
    const block = blockConstructor({
        colour: Colors.HTML,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector',
        message: 'elemento da página',
        name: blockName,
        tooltip: 'Escolhe um elemento da página web quando conectado a outro bloco',
        hasOutput: BlocklyTypes.HTML_ELEMENT,
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const textValue = (block as any).promptValue || '';
            return [`document.querySelector("${textValue.replace(/"/g, '\\"')}")`, Order.ATOMIC];
        },
        installListener: (workspace: Blockly.Workspace, event: BlocklyEvent) => {
            // Ignora eventos que não são de movimentação ou se não temos o ID do bloco
            if (!event.blockId) return;

            const block = workspace.getBlockById(event.blockId);

            // Ignora se não é o nosso tipo de bloco ou se já foi processado
            if (!block || block.type !== blockName) return;

            // Detecta quando um bloco é movido (solto no workspace)
            if (event.type === Blockly.Events.BLOCK_MOVE && event.reason?.includes("connect")) {
                // Verifica se o bloco está realmente no workspace principal
                // e não é um bloco fantasma/temporário
                if (block.workspace &&
                    !block.workspace.isFlyout &&
                    block.isEnabled()) {

                    const userInput = window.confirm('Deseja ajuda para selecionar um elemento da página?');
                    if (userInput) {


                        fetchActualWorkspaceName().then((workspaceName) => {
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                const tabId = tabs[0]?.id || 0;

                                if (!tabId) {
                                    window.alert('Não foi possível obter o ID da aba, tente novamente.');
                                    return;
                                }

                                setElementSelection(block.id, workspaceName, tabId).then(() => {
                                    window.alert('Selecione um elemento da página clicando nele, veja qual é o elemento antes de clicar passando o mouse sobre ele.');
                                    window.close();
                                });
                            });
                        });
                    } else {
                        window.alert('Então vá a merda!');
                        // Se o usuário clicou em cancelar ou não forneceu texto, deleta o bloco
                        block.dispose();
                    }
                }
            }
        }
    });

    return block;
};

export default setBlockDynamicElementSelector;