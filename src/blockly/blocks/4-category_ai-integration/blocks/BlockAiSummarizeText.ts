import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiSummarizeText = () => {
    return blockConstructor({
        // Utiliza a cor destinada à IA (definida em colors.ts)
        colour: Colors.AI,
        // Define o bloco como uma expressão que retorna um texto;
        // Aqui utilizamos o tipo 'textVariable' definido em types.ts
        hasOutput: BlocklyTypes.textVariable,
        helpUrl: 'https://example.com/ai-summarization',
        name: 'BlockAiSummarizeText',
        fields: [
            {
                type: 'text',
                text: 'Resumo de texto\n%1',
            },
            {
                type: 'field_variable',
                name: 'PROMPT',
                variable: BlocklyTypes.textVariable,
                variableTypes: [''],
            },
        ],
        tooltip: 'Gera um resumo do texto usando IA, condensando informações extensas ou simplificando respostas.',
        // O gerador retorna uma expressão chamando uma função fictícia "aiSummarizeText"
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiSummarizeText;
