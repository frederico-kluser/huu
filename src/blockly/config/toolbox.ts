import { BlocklyOptions } from 'blockly';

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
            name: 'Seleção 2',
            hidden: "true",
            contents: [
                {
                    kind: 'block',
                    type: 'math_number',
                    fields: {
                        NUM: '9',
                    },
                }
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