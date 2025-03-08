import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyVariableNames from '../../../config/variable-names';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockAiSummarizeText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasOutput: BlocklyVariableNames.textVariable,
        helpUrl: 'https://example.com/ai-summarization',
        message: 'Resumo de texto\n%1',
        name: 'BlockAiSummarizeText',
        tooltip: 'Gera um resumo do texto usando IA, condensando informações extensas ou simplificando respostas.',
        fields: [
            {
                type: 'field_variable',
                name: 'PROMPT',
                variable: BlocklyVariableNames.textVariable,
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const varName = generator.nameDB_?.getName(block.getFieldValue('PROMPT'), Blockly.VARIABLE_CATEGORY_NAME);

            // Chamando a função assíncrona getSummarizedText com o texto como argumento
            const code = `await getSummarizedText(${varName})`;

            // Como estamos usando await, a precedência é AWAIT (4.8)
            return [code, Order.AWAIT];
        },
    });
};

export default setBlockAiSummarizeText;
