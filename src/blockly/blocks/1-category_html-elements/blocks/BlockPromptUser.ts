import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockPromptUser = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.textVariable, // bloco que retorna a resposta do usuário
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt',
        name: 'BlockPromptUser',
        fields: [
            {
                type: 'text',
                text: 'browser prompt %1',
            },
            {
                type: 'input_value',
                name: 'PROMPT_MESSAGE',
            },
        ],
        tooltip: 'Exibe um prompt para o usuário inserir informações.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockPromptUser;
