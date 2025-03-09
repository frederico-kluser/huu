import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockDelayWait = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout',
        message: 'aguarde %1 milissegundos\ndepois faça %2',
        name: 'BlockDelayWait',
        tooltip: 'Aguarda um intervalo de tempo antes de executar os blocos aninhados.',
        fields: [
            {
                type: 'input_value',
                name: 'DELAY_TIME',
                check: BlocklyTypes.NUMBER,
                shadow: {
                    type: 'math_number',
                    fields: {
                        NUM: 1000,
                    },
                },
            },
            {
                type: 'input_statement',
                name: 'DO',
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o valor de entrada para o tempo de delay
            const delayTime = generator.valueToCode(block, 'DELAY_TIME', Order.ATOMIC) || '1000';

            // Obtém o código dos blocos aninhados
            const statementCode = generator.statementToCode(block, 'DO');

            // Cria o código ES5 usando setTimeout com uma função de callback
            const code = `setTimeout(function() {\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `}, ${delayTime});\n`;

            return code;
        },
    });
};

export default setBlockDelayWait;