import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyVariableNames from '../../../config/variable-names';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockAiTranslateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasOutput: BlocklyVariableNames.textVariable,
        helpUrl: 'https://cloud.google.com/translate/docs',
        message: 'traduz texto\n%1\npara %2',
        name: 'BlockAiTranslateText',
        tooltip: 'Traduz o texto gerado pela IA para outro idioma.',
        fields: [
            {
                type: 'input_value',
                name: 'TEXT',
                check: BlocklyTypes.STRING,
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Texto a ser traduzido',
                    }
                }
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
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o valor do texto a ser traduzido
            const text = generator.valueToCode(block, 'TEXT', Order.NONE) || '\'\'';

            // Obtém o idioma alvo do campo dropdown
            const targetLanguage = block.getFieldValue('TARGET_LANGUAGE');

            // Gera o código para chamar a função de tradução assíncrona
            const code = `await getTranslatedText(${text}, '${targetLanguage}')`;

            // Retorna o código e a ordem de precedência (AWAIT é apropriado para uma chamada de função assíncrona)
            return [code, Order.AWAIT];
        },
    });
};

export default setBlockAiTranslateText;
