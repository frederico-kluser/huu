import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockAiTranslateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        // Define que o bloco tem saída do tipo "variavelTextual1"
        hasOutput: BlocklyTypes.textVariable,
        helpUrl: 'https://cloud.google.com/translate/docs', // URL de referência para tradução
        name: 'BlockAiTranslateText',
        fields: [
            {
                type: 'text',
                text: 'traduz texto %1\npara %2',
            },
            {
                type: 'input_value',
                name: 'TEXT',
            },
            {
                type: 'field_dropdown',
                name: 'TARGET_LANGUAGE',
                options: [
                    ['Português', 'pt'],
                    ['Inglês', 'en'],
                    ['Espanhol', 'es'],
                    ['Francês', 'fr'],
                    ['Alemão', 'de'],
                    ['Italiano', 'it'],
                    ['Japonês', 'ja'],
                    ['Coreano', 'ko'],
                    ['Russo', 'ru'],
                    ['Chinês (simplificado)', 'zh-CN'],
                    ['Chinês (tradicional)', 'zh-TW'],
                ],
            },
        ],
        tooltip: 'Traduz o texto gerado pela IA para outro idioma.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockAiTranslateText;
