import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockGetHtmlVariable = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.HTML_ELEMENT,  // Este bloco produz um valor, não é um comando
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element',
        message: 'obter variável HTML %1',
        name: 'BlockGetHtmlVariable',
        tooltip: 'Obtém o valor de uma variável de elemento HTML',
        fields: [
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'elemento',
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT
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

export default setBlockGetHtmlVariable;