import * as Blockly from 'blockly/core';
import blockConstructor from '../../helpers/blockConstructor';
import Colors from '../../config/colors';
import BlocklyTypes from '../../config/types';
import { Order } from 'blockly/javascript';
import { BlocklyEvent } from '../../types/blockEvent';
import { addNewElementSelection } from '../../../core/storage/elementSelection';

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

            console.log("event", event);

            // Detecta quando um bloco é movido (solto no workspace)
            if (event.type === Blockly.Events.BLOCK_MOVE && event.reason?.includes("connect")) {
                // Verifica se o bloco está realmente no workspace principal
                // e não é um bloco fantasma/temporário
                if (block.workspace &&
                    !block.workspace.isFlyout &&
                    block.isEnabled()) {

                    console.log("CONDIÇÃO ESPERADA");

                    // Mostra o prompt
                    setTimeout(() => {
                        const userInput = window.confirm('Deseja ajuda para selecionar um elemento da página?');
                        if (userInput) {

                            addNewElementSelection(block.id).then(() => {
                                window.alert('Selecione um elemento da página clicando nele, veja qual é o elemento antes de clicar passando o mouse sobre ele.');
                                window.close();
                            });
                            /*
                                // Se o usuário forneceu um texto, substituímos o bloco por outro

                                // Primeiro, salvamos informações importantes do bloco atual
                                const parentConnection = block.outputConnection?.targetConnection;
                                const blockPos = block.getRelativeToSurfaceXY();

                                // Criamos um novo bloco (exemplo usando um bloco de texto fixo)
                                // Você pode substituir 'text' pelo tipo de bloco que desejar
                                const newBlock = workspace.newBlock('text') as any;

                                // Definimos o valor do texto no novo bloco
                                // Ajuste o nome do campo conforme o bloco de destino
                                newBlock.setFieldValue("Test", 'TEXT');

                                // Posicionamos o novo bloco na mesma posição do bloco atual
                                newBlock.moveBy(blockPos.x, blockPos.y);

                                // Reconectamos às mesmas conexões do bloco original
                                if (parentConnection) {
                                    newBlock.outputConnection.connect(parentConnection);
                                }

                                // Tornamos o novo bloco visível
                                newBlock.initSvg();
                                newBlock.render();

                                // Removemos o bloco original
                                block.dispose();
                            */
                        } else {
                            window.alert('Então vá a merda!');
                            // Se o usuário clicou em cancelar ou não forneceu texto, deleta o bloco
                            block.dispose();
                        }
                    }, 100);
                }
            }
        }
    });

    return block;
};

export default setBlockDynamicElementSelector;