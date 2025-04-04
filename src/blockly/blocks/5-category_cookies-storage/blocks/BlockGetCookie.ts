import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';
import BlocklyVariableNames from '../../../config/variable-names';

const setBlockGetCookie = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/pt-BR/docs/Web/API/Document/cookie',
        message: 'Obter valor do cookie com nome %1\nsalvar em %2\ne então executar %3',
        name: 'BlockGetCookie',
        tooltip: 'Recupera o valor de um cookie específico armazenado no navegador, possibilitando a leitura de informações persistentes.',
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
            const nameCode = generator.valueToCode(block, 'NAME', Order.ATOMIC) || "'nome'";
            const varName = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
            const statementCode = generator.statementToCode(block, 'DO');

            const code = `getCookie(${nameCode}, function(cookieValue) {\n` +
                `  ${varName} = cookieValue;\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `});\n`;

            return code;
        },
    });
};

export default setBlockGetCookie;