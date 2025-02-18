import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockRunJavaScript = () => {
    return blockConstructor({
        // Escolhemos uma cor que represente uma função “diversa”.
        colour: Colors.MISCELLANEOUS,
        // Bloco de declaração (statement): permite encaixe com blocos anteriores e posteriores.
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/eval',
        message: 'executar javascript: %1',
        name: 'BlockRunJavaScript',
        tooltip: 'Executa um código JavaScript de maneira assíncrona.',
        fields: [
            {
                type: 'input_value',
                name: 'JS_CODE',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'console.log("Hello, world!")'
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o código do input. Se nenhum código for fornecido, usa uma string vazia.
            const codeInput = generator.valueToCode(block, 'JS_CODE', Order.ATOMIC) || '""';
            // Gera um IIFE assíncrono que avalia o código recebido.
            const code = `(async () => { eval(${codeInput}); })();\n`;
            return code;
        },
    });
};

export default setBlockRunJavaScript;
