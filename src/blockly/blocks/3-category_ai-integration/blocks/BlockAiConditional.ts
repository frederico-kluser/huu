import * as Blockly from 'blockly/core';
import { Order } from "blockly/javascript";
import Colors from "../../../config/colors";
import blockConstructor from "../../../helpers/blockConstructor";
import BlocklyTypes from '../../../config/types';

const setBlockAiConditional = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/if...else',
        message: 'pergunta de sim ou não\n%1\nse sim\n%2\nsenao\n%3',
        name: 'BlockAiConditional',
        tooltip: 'Pergunta ao usuário e executa um bloco de código se a resposta for verdadeira e outro se for falsa.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o prompt'
                    }
                },
            },
            {
                type: 'input_statement',
                name: 'IF_BRANCH',
            },
            {
                type: 'input_statement',
                name: 'ELSE_BRANCH',
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptCode = generator.valueToCode(block, 'PROMPT', Order.ATOMIC) || '""';
            const branchIf = generator.statementToCode(block, 'IF_BRANCH');
            const branchElse = generator.statementToCode(block, 'ELSE_BRANCH');

            // Usando a versão com callback da função getConditionalAi em ES5
            const code =
                'getConditionalAi(' + promptCode + ', function(aiBooleanResponse) {\n' +
                '  if (aiBooleanResponse) {\n' +
                generator.prefixLines(branchIf, '    ') +
                '\n  } else {\n' +
                generator.prefixLines(branchElse, '    ') +
                '\n  }\n' +
                '});\n';

            return code;
        },
    });
};

export default setBlockAiConditional;