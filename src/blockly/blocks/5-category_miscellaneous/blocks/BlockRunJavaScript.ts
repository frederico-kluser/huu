import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockRunJavaScript = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
        message: 'executar JavaScript %1',
        name: 'BlockRunJavaScript',
        tooltip: 'Executa um trecho de código JavaScript personalizado.',
        fields: [
            {
                type: 'input_value',
                name: 'CODE',
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockRunJavaScript;
