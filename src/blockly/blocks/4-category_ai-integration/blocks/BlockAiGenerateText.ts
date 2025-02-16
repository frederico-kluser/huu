import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI, // Escolhemos a cor HTML; ajuste se desejar outra cor.
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://openai.com/blog/chatgpt',
        name: 'BlockAiGenerateText',
        // Importante: Use apenas UM campo de texto para compor a mensagem.
        fields: [
            {
                type: 'text',
                text: 'Pergunta para IA %1\nsalvar resultado em\n%2',
            },
            {
                type: 'input_value',
                name: 'PROMPT',
            },
            {
                type: 'field_variable',
                name: 'OUTPUT',
                variable: BlocklyTypes.textVariable,
                variableTypes: [''],
            },
        ],
        tooltip: 'Envia um prompt para o ChatGPT e armazena o texto gerado em uma variável.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiGenerateText;
