import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockSetNumberVariable = () => {
    return blockConstructor({
        colour: Colors.MATH,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number',
        message: 'definir variável número %1 para %2',
        name: 'BlockSetNumberVariable',
        tooltip: 'Define o valor de uma variável numérica',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'numero',
                variableTypes: [BlocklyTypes.NUMBER],
                defaultType: BlocklyTypes.NUMBER
            },
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.NUMBER,
                shadow: {
                    type: 'math_number',
                    fields: {
                        NUM: 0
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o nome da variável
            const variable = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);

            // Obtém o valor a ser atribuído à variável
            const value = generator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '0';

            // Gera o código para atribuir o valor à variável
            const code = `${variable} = ${value};\n`;

            return code;
        },
    });
};

export default setBlockSetNumberVariable;