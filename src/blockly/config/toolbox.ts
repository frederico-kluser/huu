import { BlocklyOptions } from 'blockly';
import configCustomBlocks from '../blocks';

configCustomBlocks();

const blocklyToolbox: BlocklyOptions['toolbox'] = {
    kind: 'categoryToolbox',
    contents: [
        {
            kind: 'category',
            name: 'Seleção',
            contents: [
                {
                    kind: 'block',
                    type: 'controls_if',
                },
                {
                    kind: 'block',
                    type: 'logic_compare',
                },
                {
                    kind: 'block',
                    type: 'math_number',
                },
                {
                    kind: 'block',
                    type: 'math_number',
                    fields: {
                        NUM: '9',
                    },
                },
                // adicionar string
                {
                    kind: 'block',
                    type: 'text',
                },
                {
                    kind: 'block',
                    type: 'text_print',
                },
                {
                    kind: "block",
                    type: "controls_for",
                    inputs: {
                        FROM: {
                            block: {
                                type: "math_number",
                                fields: {
                                    NUM: 1
                                }
                            }
                        },
                        TO: {
                            block: {
                                type: "math_number",
                                fields: {
                                    NUM: 10
                                }
                            }
                        },
                        BY: {
                            block: {
                                type: "math_number",
                                fields: {
                                    NUM: 1
                                }
                            }
                        },
                    }
                },
            ],
        },
        {
            kind: 'category',
            name: 'Custom',
            // hidden: "true",
            contents: [
                {
                    kind: 'block',
                    type: 'string_length',
                },
            ],
        },
        {
            kind: 'sep', // Separator
        },
        {
            kind: 'category',
            name: 'IA',
            contents: [
                {
                    kind: 'block',
                    type: 'logic_compare',
                    disabled: true,
                },
                {
                    kind: 'category',
                    name: 'Turn',
                    contents: [
                        {
                            kind: 'block',
                            type: 'logic_compare',
                        },
                    ],
                },
            ],
        },
    ],
};

export default blocklyToolbox;