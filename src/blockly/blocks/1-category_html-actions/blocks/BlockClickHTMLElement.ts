import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockClickHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/click',
        message: 'clicar no elemento selecionado\n%1',
        name: 'BlockClickHTMLElement',
        tooltip: 'Simula um clique do mouse no elemento HTML armazenado na variável. Use este bloco com um bloco seletor de elementos para interagir com botões e links na página.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const varName = generator.nameDB_?.getName(block.getFieldValue('VARIABLE'), Blockly.VARIABLE_CATEGORY_NAME);

            // Gera código para chamar o método click() no elemento HTML
            const code = `${varName}.click();\n`;
            return code;
        },
    });
};

export default setBlockClickHTMLElement;