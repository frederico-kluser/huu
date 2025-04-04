import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockLocalStorageRemoveItem = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Window/localStorage',
        message: 'Remover do localStorage o item com chave %1',
        name: 'BlockLocalStorageRemoveItem',
        tooltip: 'Remove um item do localStorage com base na chave especificada, útil para limpar dados antigos ou redefinir configurações.',
        fields: [
            {
                type: 'input_value',
                name: 'KEY',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'chave',
                    },
                },
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const keyCode = generator.valueToCode(block, 'KEY', Order.ATOMIC) || "'chave'";

            const code = `localStorage.removeItem(${keyCode});\n`;
            return code;
        },
    });
};

export default setBlockLocalStorageRemoveItem;