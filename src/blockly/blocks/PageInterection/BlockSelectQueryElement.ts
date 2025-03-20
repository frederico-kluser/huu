import * as Blockly from 'blockly/core';
import { Order } from 'blockly/javascript';
import blockConstructor from '../../helpers/blockConstructor';
import Colors from '../../config/colors';
import BlocklyTypes from '../../config/types';

const setBlockSelectQueryElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: 'String',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelector',
        message: 'encontrar elemento na página %1',
        name: 'BlockSelectQueryElement',
        output: BlocklyTypes.HTML_ELEMENT,
        tooltip: 'Encontra um elemento na página. Use # para buscar por ID (ex: #meuBotao), . para buscar por classe (ex: .minhaClasse), ou o nome da tag (ex: button).',
        fields: [
            {
                type: 'input_value',
                name: 'SELECTOR',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: '#botao'
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const selector =
                generator.valueToCode(block, 'SELECTOR', Order.ATOMIC) || '""';
            const code = `document.querySelector(${selector})`;
            return [code, Order.ATOMIC];
        },
    });
};

export default setBlockSelectQueryElement;