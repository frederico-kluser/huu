import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockExtractSiteContent = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: BlocklyTypes.STRING,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/innerText',
        message: 'extrair texto do site',
        name: 'BlockExtractSiteContent',
        tooltip: 'Extrai todo o conteúdo de texto visível da página atual.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const code = `(function() { 
  var siteContent = document.body.innerText;
  siteContent = siteContent.replace(/\\s+/g, ' ');
  return siteContent;
})()`;

            return [code, Order.FUNCTION_CALL];
        },
    });
};

export default setBlockExtractSiteContent;