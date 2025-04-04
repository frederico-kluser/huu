import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockDeleteCookie = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Document/cookie',
        message: 'Excluir cookie com nome %1',
        name: 'BlockDeleteCookie',
        tooltip: 'Remove um cookie específico do navegador, útil para limpar dados de sessão ou redefinir preferências.',
        fields: [
            {
                type: 'input_value',
                name: 'NAME',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'nomeCookie',
                    },
                },
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const nameCode = generator.valueToCode(block, 'NAME', Order.ATOMIC) || "'nome'";

            const code = `deleteCookie(${nameCode});\n`;
            return code;
        },
    });
};

export default setBlockDeleteCookie;