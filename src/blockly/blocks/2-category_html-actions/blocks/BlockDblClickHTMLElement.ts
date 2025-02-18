import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';

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
                variable: '',
                variableTypes: [''],
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockDblClickHTMLElement;
