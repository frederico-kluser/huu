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
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockRefreshPage;
