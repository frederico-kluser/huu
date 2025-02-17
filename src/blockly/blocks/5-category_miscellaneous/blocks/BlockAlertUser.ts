import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';

const setBlockAlertUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        // Bloco de comando: permite conexão anterior e seguinte.
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/alert',
        message: 'exibe alerta: %1',
        name: 'BlockAlertUser',
        tooltip: 'Exibe um alerta com a mensagem especificada.',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Alerta!'
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const message = generator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '""';
            const code = `window.alert(${message});\n`;
            return code;
        },
    });
};

export default setBlockAlertUser;
