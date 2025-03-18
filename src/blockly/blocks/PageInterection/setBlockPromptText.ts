import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import blockConstructor from '../../helpers/blockConstructor';
import Colors from '../../config/colors';
import BlocklyTypes from '../../config/types';

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
                type: 'field_label',  // Usamos label em vez de input para não ser editável
                name: 'TEXT_DISPLAY',
                text: '...'  // Texto inicial
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const textValue = (block as any).promptValue || block.getFieldValue('TEXT_DISPLAY');
            return [`"${textValue.replace(/"/g, '\\"')}"`, Order.ATOMIC];
        },
    });

    // Instala o listener de eventos no workspace quando o bloco for usado
    let listenerInstalled = false;

    // Armazena os IDs dos blocos que já processamos
    const processedBlocks = new Set();

    // Função para instalar o listener de eventos no workspace
    const installListener = (workspace: any) => {
        if (listenerInstalled) return;

        workspace.addChangeListener((event: any) => {
            // Detecta quando um bloco é criado E adicionado ao workspace
            if (event.type === Blockly.Events.BLOCK_CREATE) {
                const block = workspace.getBlockById(event.blockId);

                // Verifica se é o nosso tipo de bloco e se ainda não foi processado
                if (block &&
                    block.type === 'BlockPromptText' &&
                    !processedBlocks.has(block.id)) {

                    // Marca o bloco como processado para não repetir o prompt
                    processedBlocks.add(block.id);

                    // Mostra o prompt
                    setTimeout(() => {
                        const userInput = window.prompt("Digite o texto para este bloco:", "");
                        if (userInput !== null) {
                            // Armazena o valor personalizado
                            block.promptValue = userInput;
                            // Atualiza o texto do label
                            block.setFieldValue(userInput, "TEXT_DISPLAY");
                        }
                    }, 100);
                }
            }

            // Limpa IDs de blocos que foram excluídos
            if (event.type === Blockly.Events.BLOCK_DELETE) {
                processedBlocks.delete(event.blockId);
            }
        });

        listenerInstalled = true;
    };

    // Substitui a inicialização original para instalar nosso listener
    const originalInit = Blockly.Blocks['BlockPromptText'].init;

    Blockly.Blocks['BlockPromptText'].init = function () {
        originalInit.call(this);

        // Instala o listener no workspace quando este bloco for usado pela primeira vez
        if (this.workspace) {
            installListener(this.workspace);
        }
    };

    return block;
};

export default setBlockPromptText;