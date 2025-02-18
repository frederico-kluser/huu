import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockClickHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click',
        message: 'clicar no elemento\n%1',
        name: 'BlockClickHTMLElement',
        tooltip: 'Clica no elemento HTML armazenado na variável.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.htmlElementVariable,
                variableTypes: [BlocklyTypes.htmlElement],
                defaultType: BlocklyTypes.htmlElement,
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockClickHTMLElement;
