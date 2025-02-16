import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockDelayWait = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout',
        message: 'aguardar %1 ms',
        name: 'BlockDelayWait',
        tooltip: 'Introduz um atraso na execução de ações, sincronizando interações.',
        fields: [
            {
                type: 'field_input',
                name: 'DELAY_TIME',
                text: '1000',
            }
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockDelayWait;
