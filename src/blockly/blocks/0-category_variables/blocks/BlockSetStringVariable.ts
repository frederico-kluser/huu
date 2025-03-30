import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockSetStringVariable = () => {
    return blockConstructor({
        colour: Colors.VAR_TEXTS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String',
        message: 'definir variável texto %1 para %2',
        name: 'BlockSetStringVariable',
        tooltip: 'Define o valor de uma variável de texto',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'texto',
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING
            },
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: ''
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o nome da variável
            const variable = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);

            // Obtém o valor a ser atribuído à variável
            const value = generator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || '""';

            // Gera o código para atribuir o valor à variável
            const code = `${variable} = ${value};\n`;

            return code;
        },
    });
};

export default setBlockSetStringVariable;