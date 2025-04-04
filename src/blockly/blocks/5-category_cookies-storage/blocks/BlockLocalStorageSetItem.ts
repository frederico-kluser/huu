import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockLocalStorageSetItem = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Window/localStorage',
        message: 'Salvar no localStorage com chave %1 valor %2',
        name: 'BlockLocalStorageSetItem',
        tooltip: 'Armazena um par chave-valor no localStorage do navegador, permitindo a persistência de dados entre sessões.',
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
            },
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'valor',
                    },
                },
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const keyCode = generator.valueToCode(block, 'KEY', Order.ATOMIC) || "'chave'";
            const valueCode = generator.valueToCode(block, 'VALUE', Order.ATOMIC) || "'valor'";

            const code = `localStorage.setItem(${keyCode}, ${valueCode});\n`;
            return code;
        },
    });
};

export default setBlockLocalStorageSetItem;