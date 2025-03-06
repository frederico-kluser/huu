import * as Blockly from 'blockly/core';
import blockConstructor from '../../../helpers/blockConstructor';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockNavigateToUrlText = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/location',
        message: 'navegar para URL %1',
        name: 'BlockNavigateToUrlText',
        tooltip: 'Navega para uma nova URL, alterando a página atual.',
        fields: [
            {
                type: 'input_value',
                name: 'URL',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'https://www.google.com'
                    }
                }
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obter o código para o valor da URL
            const url = generator.valueToCode(block, 'URL', Order.ASSIGNMENT) || "'https://www.google.com'";

            // Gerar o código para navegar para a URL
            const code = `window.location.href = ${url};\n`;

            return code;
        }
    });
};

export default setBlockNavigateToUrlText;
