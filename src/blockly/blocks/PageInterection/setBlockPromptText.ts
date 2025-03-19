import * as Blockly from 'blockly/core';
import blockConstructor from '../../helpers/blockConstructor';
import Colors from '../../config/colors';
import BlocklyTypes from '../../config/types';
import { Order } from 'blockly/javascript';

const setBlockPromptText = () => {
    // Registramos o tipo de bloco usando nosso constructor
    const block = blockConstructor({
        colour: Colors.HTML,
        helpUrl: '',
        message: 'texto: %1',
        name: 'BlockPromptText',
        tooltip: 'Bloco de texto com valor definido por prompt quando adicionado ao workspace',
        hasOutput: BlocklyTypes.STRING,
        fields: [
            {
                type: 'field_label',
                name: 'TEXT_DISPLAY',
                text: '...'
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const textValue = (block as any).promptValue || block.getFieldValue('TEXT_DISPLAY');
            return [`"${textValue.replace(/"/g, '\\"')}"`, Order.ATOMIC];
        },
        installListener: (workspace: Blockly.Workspace, event: any) => {
            // Ignora eventos que não são de movimentação ou se não temos o ID do bloco
            if (!event.blockId) return;

            const block = workspace.getBlockById(event.blockId);

            // Ignora se não é o nosso tipo de bloco ou se já foi processado
            if (!block || block.type !== 'BlockPromptText') return;

            console.log("event", event);

            /*
            reason: [
                "drag",
                "snap"
            ]
            
            reason: [
                "drag",
                "connect"
            ]
            */

            // Detecta quando um bloco é movido (solto no workspace)
            if (event.type === Blockly.Events.BLOCK_MOVE && event.reason?.includes("connect")) {
                // Verifica se o bloco está realmente no workspace principal
                // e não é um bloco fantasma/temporário
                if (block.workspace &&
                    !block.workspace.isFlyout &&
                    block.isEnabled()) {
                    // Mostra o prompt
                    setTimeout(() => {
                        const userInput = window.prompt("Digite o texto para este bloco:", "");
                        if (userInput !== null) {
                            block.setFieldValue(userInput, "TEXT_DISPLAY");
                        }
                    }, 100);
                }
            }
        }
    });

    return block;
};

export default setBlockPromptText;