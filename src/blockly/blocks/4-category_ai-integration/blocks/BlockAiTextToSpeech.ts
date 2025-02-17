import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockAiTextToSpeech = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis',
        message: 'Falar o texto %1',
        name: 'BlockAiTextToSpeech',
        tooltip: 'Converte o texto gerado pela IA em fala, utilizando a API SpeechSynthesis.',
        fields: [
            {
                type: 'input_value',
                name: 'TEXT',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Texto para falar',
                    }
                }
            }
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiTextToSpeech;
