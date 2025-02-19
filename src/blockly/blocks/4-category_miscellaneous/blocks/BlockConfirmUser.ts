import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockConfirmUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm',
        message: 'confirmar %1\nse sim\n%2\nsenao\n%3',
        name: 'BlockConfirmUser',
        tooltip:
            'Exibe uma janela de confirmação com a mensagem especificada e executa um dos dois blocos de código dependendo do resultado.',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Você confirma?'
                    }
                }
            },
            {
                type: 'input_statement',
                name: 'IF_BRANCH'
            },
            {
                type: 'input_statement',
                name: 'ELSE_BRANCH'
            }
        ],
        generator: function (
            block: Blockly.Block,
            generator: Blockly.CodeGenerator
        ) {
            const message =
                generator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '""';
            const branchIf = generator.statementToCode(block, 'IF_BRANCH');
            const branchElse = generator.statementToCode(block, 'ELSE_BRANCH');

            const code =
                'if (window.confirm(' + message + ')) {\n' +
                branchIf +
                '} else {\n' +
                branchElse +
                '}\n';
            return code;
        }
    });
};

export default setBlockConfirmUser;
