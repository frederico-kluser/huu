import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockAiTextToSpeech = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis',
        name: 'BlockAiTextToSpeech',
        fields: [
            {
                type: 'text',
                text: 'Falar o texto %1',
            },
            {
                type: 'input_value',
                name: 'TEXT',
            }
        ],
        tooltip: 'Converte o texto gerado pela IA em fala, utilizando a API SpeechSynthesis.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiTextToSpeech;
