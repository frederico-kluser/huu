import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';

const setBlockConfirmUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasOutput: 'Boolean',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm',
        message: 'confirmar %1',
        name: 'BlockConfirmUser',
        tooltip: 'Exibe uma janela de confirmação com a mensagem especificada e retorna o resultado (true ou false).',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Você confirma?'
                    }
                },
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const message = generator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '""';
            const code = `window.confirm(${message})`;
            return [code, Order.FUNCTION_CALL];
        },
    });
};

export default setBlockConfirmUser;
