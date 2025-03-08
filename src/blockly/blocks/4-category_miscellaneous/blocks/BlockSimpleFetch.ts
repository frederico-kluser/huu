import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockSimpleFetch = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasOutput: 'Boolean',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest',
        message: 'testar URL com XHR %1',
        name: 'BlockSimpleFetch',
        tooltip: 'Faz uma requisição GET síncrona para testar se a URL está acessível.',
        fields: [
            {
                type: 'input_value',
                name: 'URL',
                check: BlocklyTypes.STRING,
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const urlValue = generator.valueToCode(block, 'URL', Order.ATOMIC) || '""';

            const code = `(function() {
    var xhr = new XMLHttpRequest();
    var url = ${urlValue};
    var success = false;
    
    try {
        xhr.open('GET', url, false);
        xhr.send();
        
        if (xhr.status >= 200 && xhr.status < 300) {
            console.log('Sucesso:', xhr.status, xhr.responseText);
            success = true;
        } else {
            console.error('Erro HTTP:', xhr.status, xhr.statusText);
        }
    } catch (error) {
        console.error('Erro na requisição:', error.message);
    }
    
    return success;
})()`;

            return [code, Order.NONE];
        },
    });
};

export default setBlockSimpleFetch;