import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';
import { Order } from 'blockly/javascript';

const setBlockAiTranslateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasPreviousConnection: null,
        helpUrl: 'https://platform.openai.com/docs/guides/prompt-engineering',
        message: 'traduz texto %1\npara %2\nsalvar em %3\nfazer %4',
        name: 'BlockAiTranslateText',
        tooltip: 'Traduz o texto para outro idioma, salva na variável e executa os blocos aninhados.',
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
            {
                type: 'field_variable',
                name: 'VAR',
                variable: 'traducao',
                variableTypes: [BlocklyTypes.STRING],
                defaultType: BlocklyTypes.STRING,
            },
            {
                type: 'input_statement',
                name: 'DO',
            }
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Obtém o valor do texto a ser traduzido
            const text = generator.valueToCode(block, 'TEXT', Order.NONE) || '\'\'';

            // Obtém o idioma alvo do campo dropdown
            const targetLanguage = block.getFieldValue('TARGET_LANGUAGE');

            // Obtém o nome da variável para armazenar a tradução
            const varName = generator.nameDB_?.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);

            // Obtém o código dos blocos aninhados
            const statementCode = generator.statementToCode(block, 'DO');

            // Gera o código para chamar a função de tradução com callback (ES5)
            const code = `getTranslatedText(${text}, '${targetLanguage}', function(translation) {\n` +
                `  ${varName} = translation;\n` +
                `  ${statementCode.replace(/^  /gm, '  ')}\n` +
                `});\n`;

            return code;
        },
    });
};

export default setBlockAiTranslateText;