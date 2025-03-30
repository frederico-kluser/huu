import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockWriteValueToInputElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#value',
        message: 'escrever %1\nno input %2',
        name: 'BlockWriteValueToInputElement',
        tooltip:
            'Define o valor de um elemento de formulário (input, textarea ou select) HTML previamente selecionado.',
        fields: [
            {
                type: 'input_value',
                name: 'VALUE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o valor'
                    }
                }
            },
            {
                type: 'input_value',
                name: 'ELEMENT_SELECTOR',
                check: BlocklyTypes.HTML_ELEMENT,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obter o nome da variável do elemento HTML
            const elementSelector = generator.valueToCode(block, 'ELEMENT_SELECTOR', Order.ATOMIC) || 'document.querySelector("")';

            // Obter o código para o valor (que pode ser um bloco conectado)
            const valueCode = generator.valueToCode(block, 'VALUE', Order.NONE) || '""';

            // Gerar o código para definir o value do elemento de input
            // const code = `${elementSelector}.value = ${valueCode};\n`;
            const code = `window.setInputValue(${elementSelector}, ${valueCode});\n`;

            return code;
        }
    });
};

export default setBlockWriteValueToInputElement;