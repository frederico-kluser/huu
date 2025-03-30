import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockGetStringVariable = () => {
    return blockConstructor({
        colour: Colors.VAR_TEXTS,
        hasOutput: BlocklyTypes.STRING,  // Este bloco produz um valor de texto
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String',
        message: 'obter variável texto %1',
        name: 'BlockGetStringVariable',
        tooltip: 'Obtém o valor de uma variável de texto',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'texto',
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING
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

export default setBlockGetStringVariable;