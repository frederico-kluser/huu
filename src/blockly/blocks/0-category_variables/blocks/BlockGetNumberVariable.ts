import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockGetNumberVariable = () => {
    return blockConstructor({
        colour: Colors.MATH,
        hasOutput: BlocklyTypes.NUMBER,  // Este bloco produz um valor numérico
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number',
        message: 'obter variável número %1',
        name: 'BlockGetNumberVariable',
        tooltip: 'Obtém o valor de uma variável numérica',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'numero',
                variableTypes: [BlocklyTypes.NUMBER],
                defaultType: BlocklyTypes.NUMBER
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o nome da variável
            const variable = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);

            // Retorna o código e a prioridade da operação
            return [variable, Order.ATOMIC];
        },
    });
};

export default setBlockGetNumberVariable;