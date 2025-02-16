import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiConditional = () => {
    return blockConstructor({
        colour: Colors.AI,
        // Para blocos de lógica, costumamos permitir conexão anterior e seguinte
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/if...else',
        name: 'BlockAiConditional',
        fields: [
            {
                type: 'text',
                text: 'Se (IA prompt %1)\nentão: %2 senão: %3'
            },
            {
                type: 'field_variable',
                name: 'PROMPT',
                variable: BlocklyTypes.promptVariable,
                variableTypes: [''],
            },
            {
                type: 'input_statement',
                name: 'IF'
            },
            {
                type: 'input_statement',
                name: 'ELSE'
            }
        ],
        tooltip: 'Executa lógica condicional baseada na resposta da IA.',
        generator: function (block: Blockly.Block, generator: any) {
            // Recupera o prompt inserido pelo usuário
            const promptText = block.getFieldValue('PROMPT');
            // Gera o código para os ramos if e else
            const branchIf = generator.statementToCode(block, 'IF');
            const branchElse = generator.statementToCode(block, 'ELSE');

            // Aqui estamos assumindo a existência de uma função getAiResponse(prompt)
            // que retorna um valor truthy/falsy com base na resposta da IA.
            const code = `
const aiResponse = getAiResponse(${generator.quote_(promptText)});
if (aiResponse) {
${branchIf}
} else {
${branchElse}
}
`;
            return code;
        }
    });
};

export default setBlockAiConditional;
