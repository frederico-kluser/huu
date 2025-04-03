import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockAlertUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        // Bloco de comando: permite conexão anterior e seguinte.
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/alert',
        message: 'mostrar alerta para o usuário: %1',
        name: 'BlockAlertUser',
        tooltip: 'Exibe uma caixa de mensagem de alerta para o usuário do site com o texto especificado. O alerta interrompe a execução do agente até que o usuário clique em OK.',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                check: BlocklyTypes.STRING,
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
