import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockIfElementExists = () => {
    return blockConstructor({
        colour: Colors.SELECTORS,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector',
        message: 'se elemento %1 existe\nentão %2\nsenão %3',
        name: 'BlockIfElementExists',
        tooltip: 'Verifica se um elemento existe na página. Se existir, executa o primeiro bloco de código, caso contrário, executa o segundo.',
        fields: [
            {
                type: 'input_value',
                name: 'ELEMENT_SELECTOR',
                check: BlocklyTypes.HTML_ELEMENT,
            },
            {
                type: 'input_statement',
                name: 'DO_IF_TRUE',
            },
            {
                type: 'input_statement',
                name: 'DO_IF_FALSE',
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const elementSelector = generator.valueToCode(block, 'ELEMENT_SELECTOR', Order.ATOMIC) || 'document.querySelector("")';
            const doIfTrue = generator.statementToCode(block, 'DO_IF_TRUE');
            const doIfFalse = generator.statementToCode(block, 'DO_IF_FALSE');

            // Condição para verificar se o elemento existe
            const checkCondition = `huu_var_element !== undefined && huu_var_element !== null`;

            // Constrói o código para a verificação condicional
            const code = `
(function() { 
  var huu_var_element = ${elementSelector};
  
  if (${checkCondition}) {
${doIfTrue.replace(/^/gm, '    ')}
  } else {
${doIfFalse.replace(/^/gm, '    ')}
  }
})();
`;

            return code;
        },
    });
};

export default setBlockIfElementExists;