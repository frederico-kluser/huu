import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockPromptUser = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasOutput: 'String',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt',
        message: 'Perguntar ao usuário: %1 valor padrão: %2',
        name: 'BlockPromptUser',
        tooltip: 'Exibe um prompt para o usuário e retorna a entrada digitada.',
        fields: [
            {
                type: 'input_value',
                name: 'MESSAGE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite algo'
                    }
                }
            },
            {
                type: 'input_value',
                name: 'DEFAULT_VALUE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Valor padrão'
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptMessage = generator.valueToCode(block, 'MESSAGE', Order.ATOMIC) || '""';
            const defaultValue = generator.valueToCode(block, 'DEFAULT_VALUE', Order.ATOMIC) || '""';
            const code = `window.prompt(${promptMessage}, ${defaultValue})`;
            return [code, Order.FUNCTION_CALL];
        }
    });
};

export default setBlockPromptUser;