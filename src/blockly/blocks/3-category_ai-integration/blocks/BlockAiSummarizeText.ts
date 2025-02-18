import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyVariableNames from '../../../config/variable-names';

const setBlockAiSummarizeText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasOutput: BlocklyVariableNames.textVariable,
        helpUrl: 'https://example.com/ai-summarization',
        message: 'Resumo de texto\n%1',
        name: 'BlockAiSummarizeText',
        tooltip: 'Gera um resumo do texto usando IA, condensando informações extensas ou simplificando respostas.',
        fields: [
            {
                type: 'field_variable',
                name: 'PROMPT',
                variable: BlocklyVariableNames.textVariable,
                variableTypes: [''],
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiSummarizeText;
