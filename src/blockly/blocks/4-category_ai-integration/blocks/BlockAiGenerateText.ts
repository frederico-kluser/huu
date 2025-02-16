import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://openai.com/blog/chatgpt',
        message: 'Pergunta para IA %1\nsalvar resultado em\n%2',
        name: 'BlockAiGenerateText',
        tooltip: 'Envia um prompt para o ChatGPT e armazena o texto gerado em uma variável.',
        fields: [
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
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiGenerateText;
