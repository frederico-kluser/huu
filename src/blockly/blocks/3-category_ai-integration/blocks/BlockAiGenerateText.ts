import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockAiGenerateText = () => {
    return blockConstructor({
        colour: Colors.AI,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://platform.openai.com/docs/guides/prompt-engineering',
        message: 'Pergunta para IA\n%1\nsalvar resultado em\n%2',
        name: 'BlockAiGenerateText',
        tooltip: 'Envia um prompt para o ChatGPT e armazena o texto gerado em uma variável.',
        fields: [
            {
                type: 'input_value',
                name: 'PROMPT',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o prompt',
                    },
                },
            },
            {
                type: 'field_variable',
                name: 'OUTPUT',
                variable: BlocklyTypes.HTML_ELEMENT,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            },
        ],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const promptCode = generator.valueToCode(block, 'PROMPT', Order.ATOMIC) || '""';
            const outputVar =
                generator.nameDB_?.getName(
                    block.getFieldValue('OUTPUT'),
                    Blockly.VARIABLE_CATEGORY_NAME
                ) || 'output';
            const code = `${outputVar} = await aiGenerateText(${promptCode});\n`;
            return code;
        },
    });
};

export default setBlockAiGenerateText;
