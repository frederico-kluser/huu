import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockSetCookie = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Document/cookie',
        message: 'Definir cookie com nome %1 valor %2 e expiração em dias %3',
        name: 'BlockSetCookie',
        tooltip: 'Cria ou atualiza um cookie no navegador com um nome e valor especificados, permitindo a persistência de informações.',
        fields: [
            {
                type: 'input_value',
                name: 'NAME',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'nomeCookie',
                    },
                },
            },
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'valorCookie',
                    },
                },
            },
            {
                type: 'input_value',
                name: 'DAYS',
                check: BlocklyTypes.NUMBER,
                shadow: {
                    type: 'math_number',
                    fields: {
                        NUM: 30,
                    },
                },
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const nameCode = generator.valueToCode(block, 'NAME', Order.ATOMIC) || "'nome'";
            const valueCode = generator.valueToCode(block, 'VALUE', Order.ATOMIC) || "'valor'";
            const daysCode = generator.valueToCode(block, 'DAYS', Order.ATOMIC) || "30";

            const code = `setCookie(${nameCode}, ${valueCode}, ${daysCode});\n`;
            return code;
        },
    });
};

export default setBlockSetCookie;