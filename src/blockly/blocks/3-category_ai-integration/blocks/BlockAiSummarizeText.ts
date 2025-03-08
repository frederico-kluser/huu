import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockAiSummarizeText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasOutput: 'String',
        helpUrl: 'https://example.com/ai-summarization',
        message: 'Resumo de texto\n%1',
        name: 'BlockAiSummarizeText',
        tooltip: 'Gera um resumo do texto usando IA, condensando informações extensas ou simplificando respostas.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o texto para resumir',
                    },
                },
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptCode = generator.valueToCode(block, 'PROMPT', Order.ATOMIC) || '""';

            // Chamando a função assíncrona getSummarizedText com o texto como argumento
            const code = `await getSummarizedText(${promptCode})`;

            // Como estamos usando await, a precedência é AWAIT (4.8)
            return [code, Order.AWAIT];
        },
    });
};

export default setBlockAiSummarizeText;