import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasOutput: 'String',
        helpUrl: 'https://platform.openai.com/docs/guides/prompt-engineering',
        message: 'Pergunta para IA\n%1',
        name: 'BlockAiGenerateText',
        tooltip: 'Envia um prompt para o ChatGPT e retorna o texto gerado.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o prompt',
                    },
                },
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptCode = generator.valueToCode(block, 'PROMPT', Order.ATOMIC) || '""';
            const code = `await getGeneratedText(${promptCode})`;
            return [code, Order.AWAIT];
        },
    });
};

export default setBlockAiGenerateText;