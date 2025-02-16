import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAlertUser = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.textVariable, // bloco que retorna a resposta do usuário
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Window/alert',
        name: 'BlockAlerUser',
        fields: [
            {
                type: 'text',
                text: 'browser alert %1',
            },
            {
                type: 'input_value',
                name: 'ALERT_MESSAGE',
            },
        ],
        tooltip: 'Exibe um alerta para o usuário inserir informações.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAlertUser;
