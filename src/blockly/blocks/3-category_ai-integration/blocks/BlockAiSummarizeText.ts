import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import BlocklyVariableNames from '../../../config/variable-names';
import { Order } from 'blockly/javascript';

const setBlockAiSummarizeText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasPreviousConnection: null,
        helpUrl: 'https://cloud.google.com/use-cases/ai-summarization',
        message: 'Resumir texto:\n%1\ne salvar em %2\n%3',
        name: 'BlockAiSummarizeText',
        tooltip: 'Gera um resumo do texto usando IA, salva o resultado na variável especificada e executa os blocos aninhados.',
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
            {
                type: 'field_variable',
                name: 'VAR',
                variable: BlocklyVariableNames.textVariable,
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING,
            },
            {
                type: 'input_statement',
                name: 'DO',
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptCode = generator.valueToCode(block, 'PROMPT', Order.ATOMIC) || '""';
            const varName = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
            const statementCode = generator.statementToCode(block, 'DO');

            // Usando uma função assíncrona com callback para processar o texto e 
            // executar o código aninhado dentro dela
            const code = `getSummarizedText(${promptCode}, function(summary) {\n` +
                `  ${varName} = summary;\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `});\n`;

            return code;
        },
    });
};

export default setBlockAiSummarizeText;