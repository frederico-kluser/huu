import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';

const setBlockPromptUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasOutput: 'String',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt',
        message: 'prompt: %1',
        name: 'BlockPromptUser',
        tooltip: 'Exibe um prompt para o usuário e retorna a entrada digitada.',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite algo'
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptMessage = generator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '""';
            const code = `window.prompt(${promptMessage})`;
            return [code, Order.FUNCTION_CALL];
        }
    });
};

export default setBlockPromptUser;
