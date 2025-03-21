import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../config/colors';
import blockConstructor from '../../helpers/blockConstructor';
import BlocklyTypes from '../../config/types';

const setBlockSetHtmlVariable = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element',
        message: 'definir variável %1 para %2',
        name: 'BlockSetHtmlVariable',
        tooltip: 'Define o valor de uma variável de elemento HTML',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'elemento',
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT
            },
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.HTML_ELEMENT,
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o nome da variável
            const variable = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);

            // Obtém o valor a ser atribuído à variável
            const value = generator.valueToCode(block, 'VALUE', Order.ASSIGNMENT) || 'null';

            // Gera o código para atribuir o valor à variável
            const code = `${variable} = ${value};\n`;

            return code;
        },
    });
};

export default setBlockSetHtmlVariable;