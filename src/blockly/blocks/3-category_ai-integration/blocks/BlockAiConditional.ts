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
        message: 'perguntar à IA (sim/não)\n%1\nse resposta for SIM, fazer\n%2\nse resposta for NÃO, fazer\n%3',
        name: 'BlockAiConditional',
        tooltip: 'Envia uma pergunta para a Inteligência Artificial que exige resposta sim ou não. Dependendo da resposta, executa um dos dois caminhos possíveis. Ideal para criar decisões baseadas em análise de conteúdo ou contexto.',
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