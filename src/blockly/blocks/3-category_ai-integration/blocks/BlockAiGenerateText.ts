import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';
import BlocklyVariableNames from '../../../config/variable-names';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasPreviousConnection: null,
        helpUrl: 'https://platform.openai.com/docs/guides/prompt-engineering',
        message: 'Pedir para IA gerar texto com prompt %1\nsalvar resultado em %2\ne então executar %3',
        name: 'BlockAiGenerateText',
        tooltip: 'Envia uma instrução para a Inteligência Artificial gerar um texto, salva a resposta na variável escolhida e continua a execução. Útil para gerar conteúdo personalizado, respostas ou análises baseadas em dados do site.',
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

            // Usando uma função com callback em vez de await/Promise
            const code = `getGeneratedText(${promptCode}, function(result) {\n` +
                `  ${varName} = result;\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `});\n`;

            return code;
        },
    });
};

export default setBlockAiGenerateText;