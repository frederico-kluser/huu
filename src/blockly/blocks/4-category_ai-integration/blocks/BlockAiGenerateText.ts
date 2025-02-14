import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI, // Escolhemos a cor HTML; ajuste se desejar outra cor.
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://openai.com/blog/chatgpt',
        name: 'BlockAiGenerateText',
        // Importante: Use apenas UM campo de texto para compor a mensagem.
        fields: [
            {
                type: 'text',
                text: 'Gerar texto com prompt\n %1\ne armazenar em\n%2',
            },
            {
                type: 'field_input',
                name: 'PROMPT',
                text: 'Digite o prompt aqui',
            },
            {
                type: 'field_variable',
                name: 'OUTPUT',
                variable: BlocklyTypes.textVariable,
                variableTypes: [''],
            },
        ],
        tooltip: 'Envia um prompt para o ChatGPT e armazena o texto gerado em uma variável.',
        generator: function (block: Blockly.Block, generator: any) {
            const promptValue = block.getFieldValue('PROMPT');
            const outputVar = block.getFieldValue('OUTPUT');
            // OBS.: Certifique-se de que exista (ou implemente) a função `chatGPT` que efetue a chamada à API do ChatGPT.
            return `\n(async () => {
  const resposta = await chatGPT(${generator.quote_(promptValue)});
  ${outputVar} = resposta;
})();\n`;
        },
    });
};

export default setBlockAiGenerateText;
