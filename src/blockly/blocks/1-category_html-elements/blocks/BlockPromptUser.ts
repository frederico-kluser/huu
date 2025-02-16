import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockPromptUser = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.textVariable,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt',
        message: 'browser prompt %1',
        name: 'BlockPromptUser',
        tooltip: 'Exibe um prompt para o usuário inserir informações.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT_MESSAGE',
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockPromptUser;
