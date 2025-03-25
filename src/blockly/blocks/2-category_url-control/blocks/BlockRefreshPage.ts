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
            const code = `
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    var currentTabId = tabs[0].id;
    chrome.storage.local.set({
        huuNavigation: {
            blockId: ${block.id},
            type: 'refresh',
            tabId: currentTabId
        }
    }, function() {
        window.location.reload();
    });
});\n`;
            return code;
        },
    });
};

export default setBlockRefreshPage;