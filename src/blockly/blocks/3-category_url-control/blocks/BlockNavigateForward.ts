import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigateForward = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/History/forward',
        name: 'BlockNavigateForward',
        fields: [
            {
                type: 'text',
                text: 'navegar para frente',
            }
        ],
        tooltip: 'Navega para a próxima página no histórico do navegador.',
        generator: function (block: Blockly.Block, generator: any) {
            return 'window.history.forward();\n';
        }
    });
};

export default setBlockNavigateForward;
