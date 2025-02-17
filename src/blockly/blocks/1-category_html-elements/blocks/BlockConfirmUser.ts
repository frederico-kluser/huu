import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockConfirmUser = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.confirmVariable,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm',
        message: 'browser confirm %1',
        name: 'BlockConfirmUser',
        tooltip: 'Exibe um window confirm para o usuário aceitar ou cancelar.',
        fields: [
            {
                type: 'input_value',
                name: 'CONFIRM_MESSAGE',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Confirma?'
                    }
                }
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockConfirmUser;
