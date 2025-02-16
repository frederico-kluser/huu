import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockRunJavaScript = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
        name: 'BlockRunJavaScript',
        fields: [
            {
                type: 'text',
                text: 'executar JavaScript %1',
            },
            {
                type: 'input_value',
                name: 'CODE',
            },
        ],
        tooltip: 'Executa um trecho de código JavaScript personalizado.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockRunJavaScript;
