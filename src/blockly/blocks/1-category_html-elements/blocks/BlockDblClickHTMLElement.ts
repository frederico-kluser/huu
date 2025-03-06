import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockDblClickHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        message: 'clicar duas vezes no elemento\n%1',
        name: 'BlockDblClickHTMLElement',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click',
        tooltip: 'Clica duas vezes no elemento HTML armazenado na variável.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const varName = generator.nameDB_?.getName(block.getFieldValue('VARIABLE'), Blockly.VARIABLE_CATEGORY_NAME);

            // Gera código para chamar o método click() no elemento HTML
            const code = `${varName}.dblclick();\n`;
            return code;
        },
    });
};

export default setBlockDblClickHTMLElement;
