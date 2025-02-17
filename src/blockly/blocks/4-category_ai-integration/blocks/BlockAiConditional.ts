import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockAiConditional = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/if...else',
        message: 'Se a IA responder "Sim" para\n%1\nentão: %2\nsenão: %3',
        name: 'BlockAiConditional',
        tooltip: 'Executa lógica condicional baseada na resposta da IA.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Pergunta para IA',
                    }
                }
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
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiConditional;
