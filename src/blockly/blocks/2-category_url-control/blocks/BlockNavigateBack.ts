import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigateBack = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/History/back',
        message: 'voltar para a página anterior',
        name: 'BlockNavigateBack',
        tooltip: 'Navega para a página anterior no histórico do navegador.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const code = `
chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    var currentTabId = tabs[0].id;
    chrome.storage.local.set({
        huuNavigation: {
            blockId: ${block.id},
            type: 'back',
            tabId: currentTabId
        }
    }, function() {
        window.history.back();
    });
});\n`;
            return code;
        },
    });
};

export default setBlockNavigateBack;