import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';
import BlocklyVariableNames from '../../../config/variable-names';

const setBlockLocalStorageGetItem = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Window/localStorage',
        message: 'Recuperar do localStorage com chave %1\nsalvar em %2\ne então executar %3',
        name: 'BlockLocalStorageGetItem',
        tooltip: 'Recupera o valor associado a uma chave específica no localStorage, permitindo o acesso a dados persistentes.',
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
                type: 'field_variable',
                name: 'VAR',
                variable: BlocklyVariableNames.textVariable,
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING,
            },
            {
                type: 'input_statement',
                name: 'DO',
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const keyCode = generator.valueToCode(block, 'KEY', Order.ATOMIC) || "'chave'";
            const varName = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
            const statementCode = generator.statementToCode(block, 'DO');

            const code = `function() {\n` +
                `  var storageValue = localStorage.getItem(${keyCode});\n` +
                `  ${varName} = storageValue !== null ? storageValue : "";\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `}();\n`;

            return code;
        },
    });
};

export default setBlockLocalStorageGetItem;