import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockGetElementInnerText = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: 'String',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText',
        message: 'extrair texto do elemento\n%1',
        name: 'BlockGetElementInnerText',
        tooltip: 'Extrai o texto visível contido em um elemento HTML selecionado. Retorna apenas o conteúdo textual, ignorando tags HTML e elementos não visíveis.',
        fields: [
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const varName = generator.nameDB_?.getName(block.getFieldValue('ELEMENT'), Blockly.VARIABLE_CATEGORY_NAME);

            const code = `${varName}.innerText`;
            return [code, Order.MEMBER];
        },
    });
};

export default setBlockGetElementInnerText;
