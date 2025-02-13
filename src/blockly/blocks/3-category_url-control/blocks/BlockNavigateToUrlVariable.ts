import * as Blockly from 'blockly/core';
import blockConstructor from '../../../helpers/blockConstructor';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';

const setBlockNavigateToUrlVariable = () => {
    return blockConstructor({
        colour: Colors.URL, // utilize a cor desejada para este bloco
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/location',
        name: 'BlockNavigateToUrlVariable',
        fields: [
            {
                type: 'text',
                text: 'navegar para URL %1',
            },
            {
                type: 'field_variable',
                name: 'URL',
                variable: BlocklyTypes.textVariable,
                variableTypes: [''],
            }
        ],
        tooltip: 'Navega para uma nova URL, alterando a página atual.',
        generator: function (block: Blockly.Block, generator: any) {
            const urlValue = block.getFieldValue('URL');
            return `window.location.href = ${generator.quote_(urlValue)};\n`;
        }
    });
};

export default setBlockNavigateToUrlVariable;
