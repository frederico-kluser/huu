import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockRefreshPage = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Location/reload',
        message: 'recarregar página',
        name: 'BlockRefreshPage',
        tooltip: 'Recarrega a página atual.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const code = `window.configNavigation = ({
                    \tblockId: '${block.id}',
                    \ttype: 'refresh',
                });\n`;
            return code;
        },
    });
};

export default setBlockRefreshPage;