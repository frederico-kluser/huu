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
        message: 'aguarde %1 milissegundos',
        name: 'BlockDelayWait',
        tooltip: 'Aguarda um intervalo de tempo antes de continuar a execução.',
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
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const delayTime =
                generator.valueToCode(block, 'DELAY_TIME', Order.ATOMIC) || '0';
            // Gera código que aguarda o tempo especificado usando Promise e setTimeout.
            const code = `await new Promise(resolve => setTimeout(resolve, ${delayTime}));\n`;
            return code;
        },
    });
};

export default setBlockDelayWait;

/*
shadow: {
          type: 'text',
          fields: {
            TEXT: 'div'
          }
        }
*/