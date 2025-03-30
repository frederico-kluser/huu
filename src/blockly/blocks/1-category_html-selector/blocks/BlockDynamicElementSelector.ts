import * as Blockly from 'blockly/core';
import blockConstructor from '../../../helpers/blockConstructor';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';
import { BlocklyEvent } from '../../../types/blockEvent';
import { setElementSelection } from '../../../../core/storage/elementSelection';
import { fetchActualAgent } from '../../../../core/storage/agents';
import urlMatchesPattern from '../../../../helpers/urlMatchePattern';
import extractNavigateUrls from '../../../../pages/Content/helpers/extractNavigateUrls';

const blockName = 'BlockDynamicElementSelector';

const setBlockDynamicElementSelector = () => {
    // Registramos o tipo de bloco usando nosso constructor
    const block = blockConstructor({
        colour: Colors.SELECTORS,
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

                    fetchActualAgent().then((actialAgent) => {
                        if (!actialAgent) {
                            window.alert('Não foi possível obter o agente atual, tente novamente.');
                            block.dispose();
                            return;
                        }

                        console.log("actialAgent", actialAgent);

                        const {
                            name: workspaceName,
                            urls: workspaceUrls,
                            blocks,
                        } = actialAgent;


                        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                            const tabId = tabs[0]?.id || 0;
                            const tabUrl = tabs[0]?.url || '';

                            try {
                                if (!tabId) {
                                    throw new Error('Não foi possível obter o ID da aba, tente novamente.');
                                }

                                if (!tabUrl) {
                                    throw new Error('Não foi possível obter a URL da aba, tente novamente.');
                                }

                                let isUrlNavigationNotFound = true;
                                extractNavigateUrls(blocks).forEach((navigationURL) => {
                                    if (urlMatchesPattern(tabUrl, navigationURL)) {
                                        isUrlNavigationNotFound = false;
                                    }
                                });

                                if (!urlMatchesPattern(tabUrl, workspaceUrls) && isUrlNavigationNotFound) {
                                    throw new Error('A URL da aba atual não corresponde a nenhuma das URLs configuradas para este agente ou aos padrões de navegação definidos nos blocos. Verifique as configurações e tente novamente.');
                                }
                            } catch (error) {
                                window.alert(error);
                                block.dispose();
                                return;
                            }

                            setElementSelection(block.id, workspaceName, tabId).then(() => {
                                window.alert('Selecione um elemento da página clicando nele, veja qual é o elemento antes de clicar passando o mouse sobre ele.');
                                window.close();
                            });
                        });
                    });
                }
            }
        }
    });

    return block;
};

export default setBlockDynamicElementSelector;