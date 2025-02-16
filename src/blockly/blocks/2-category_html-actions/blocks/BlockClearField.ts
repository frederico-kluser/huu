import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockClearField = () => {
    return blockConstructor({
        colour: Colors.HTML, // Utilizando a cor definida para HTML
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reset',
        name: 'BlockClearField',
        fields: [
            {
                type: 'text',
                text: 'limpar o texto do elemento\n %1',
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: criar um tipo para elemento HTML
            },
        ],
        tooltip: 'Limpa o conteúdo de um campo de texto ou formulário.',
        generator: function (block: Blockly.Block, generator: any) {
            const fieldType = block.getFieldValue('FIELD_TYPE');
            const fieldId = block.getFieldValue('FIELD_ID');
            if (fieldType === 'text') {
                // Limpa o conteúdo de um campo de texto
                return `document.getElementById(${generator.quote_(fieldId)}).value = '';\n`;
            } else if (fieldType === 'form') {
                // Reinicia um formulário
                return `document.getElementById(${generator.quote_(fieldId)}).reset();\n`;
            } else {
                return '/* Tipo de campo desconhecido */';
            }
        }
    });
};

export default setBlockClearField;