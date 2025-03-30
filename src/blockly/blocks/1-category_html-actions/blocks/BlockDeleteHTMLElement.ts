import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';
import generateUUID from '../../../../helpers/generateUUID';

const setBlockDeleteHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/remove',
        message: 'deletar elemento %1',
        name: 'BlockDeleteHTMLElement',
        tooltip: 'Remove um elemento HTML do DOM.',
        fields: [
            {
                type: 'input_value',
                name: 'ELEMENT',
                check: BlocklyTypes.HTML_ELEMENT,
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const element = generator.valueToCode(block, 'ELEMENT', Order.ATOMIC) || 'null';

            // Check if element exists before trying to delete it
            const code = `
if (${element} && ${element}.parentNode) {
  ${element}.parentNode.removeChild(${element});
} else if (${element}) {
  ${element}.remove();
}
`;

            return code;
        },
    });
};

export default setBlockDeleteHTMLElement;