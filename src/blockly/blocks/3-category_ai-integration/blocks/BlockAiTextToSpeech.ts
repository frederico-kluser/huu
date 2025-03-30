import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiTextToSpeech = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://platform.openai.com/docs/guides/prompt-engineering',
        message: 'Falar o texto %1',
        name: 'BlockAiTextToSpeech',
        tooltip: 'Converte o texto gerado pela IA em fala, utilizando a API SpeechSynthesis.',
        fields: [
            {
                type: 'input_value',
                name: 'TEXT',
                check: BlocklyTypes.STRING,
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
