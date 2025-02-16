import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockDelayWait = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout',
        name: 'BlockDelayWait',
        fields: [
            {
                type: 'text',
                text: 'aguardar %1 ms',
            },
            {
                type: 'field_input',
                name: 'DELAY_TIME',
                text: '1000', // Valor padrão em milissegundos
            }
        ],
        tooltip: 'Introduz um atraso na execução de ações, sincronizando interações.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockDelayWait;
