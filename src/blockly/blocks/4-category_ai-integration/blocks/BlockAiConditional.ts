import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

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
                text: 'Se a IA responder "Sim" para\n%1\nentão: %2\nsenão: %3'
            },
            {
                type: 'input_value',
                name: 'PROMPT',
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
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiConditional;
