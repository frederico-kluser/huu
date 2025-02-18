import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyVariableNames from '../../../config/variable-names';
import BlocklyTypes from '../../../config/types';

const setBlockScrollToElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView',
        message: 'scrollar a tela para\n%1',
        name: 'BlockScrollToElement',
        tooltip: 'Rola a página até que o elemento selecionado esteja visível.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.htmlElement],
                defaultType: BlocklyTypes.htmlElement,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const varName = generator.nameDB_?.getName(
                block.getFieldValue('VARIABLE'),
                Blockly.VARIABLE_CATEGORY_NAME
            );
            const code = `${varName}.scrollIntoView();\n`;
            return code;
        },
    });
};

export default setBlockScrollToElement;