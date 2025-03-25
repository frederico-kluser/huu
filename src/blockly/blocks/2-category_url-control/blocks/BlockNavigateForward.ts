import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigateForward = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/History/forward',
        message: 'avançar para a próxima página',
        name: 'BlockNavigateForward',
        tooltip: 'Navega para a próxima página no histórico do navegador.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const code = `
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    var currentTabId = tabs[0].id;
    chrome.storage.local.set({
        huuNavigation: {
            blockId: ${block.id},
            type: 'forward',
            tabId: currentTabId
        }
    }, function() {
        window.history.forward();
    });
});\n`;
            return code;
        },
    });
};

export default setBlockNavigateForward;