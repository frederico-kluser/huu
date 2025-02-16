import * as Blockly from 'blockly/core';
import blockConstructor from '../../../helpers/blockConstructor';
import Colors from '../../../config/colors';

const setBlockNavigateToUrlText = () => {
    return blockConstructor({
        colour: Colors.URL, // utilize a cor desejada para este bloco
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/location',
        name: 'BlockNavigateToUrlText',
        fields: [
            {
                type: 'text',
                text: 'navegar para URL %1',
            },
            {
                type: 'input_value',
                name: 'URL',
            },
        ],
        tooltip: 'Navega para uma nova URL, alterando a página atual.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockNavigateToUrlText;
