import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockWriteTextToHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent',
        message: 'modificar conteúdo\n do elemento %2\n pelo valor %1',
        name: 'BlockWriteTextToHTMLElement',
        tooltip:
            'Insere o texto de uma variável em um elemento HTML previamente salvo.',
        fields: [
            {
                type: 'input_value',
                name: 'TEXT',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o texto'
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

            // Obter o código para o texto (que pode ser um bloco conectado)
            const textCode = generator.valueToCode(block, 'TEXT', Order.NONE) || '""';

            // Gerar o código para definir o textContent do elemento
            const code = `${elementSelector}.innerHTML = ${textCode};\n`;

            return code;
        }
    });
};

export default setBlockWriteTextToHTMLElement;
