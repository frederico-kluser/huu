import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockSimpleFetch = () => {
    return blockConstructor({
        colour: Colors.MISCELLANEOUS,
        hasOutput: 'Promise',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
        message: 'testar URL com fetch %1',
        name: 'BlockSimpleFetch',
        tooltip: 'Faz uma requisição GET simples para testar se a URL está acessível.',
        fields: [
            {
                type: 'input_value',
                name: 'URL',
                check: BlocklyTypes.STRING,
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obter a URL da requisição
            const urlValue = generator.valueToCode(block, 'URL', Order.ATOMIC) || '""';

            // Gerar o código para uma requisição fetch GET simples com then e catch
            const code = `window.fetch(${urlValue})
    .then(response => {
        console.log('Resposta da requisição:', response);
        if (!response.ok) {
            throw new Error('Falha na requisição: ' + response.status);
        }
        return response;
    })
    .catch(error => {
        console.error('Erro na requisição:', error.message);
        throw error;
    })`;

            // Retornar o código com a precedência adequada
            // Como este é um encadeamento de métodos, usamos Order.NONE para não ter problemas com precedência
            return [code, Order.NONE];
        },
    });
};

export default setBlockSimpleFetch;