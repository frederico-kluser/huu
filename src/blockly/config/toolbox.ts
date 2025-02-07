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
            ],
        },
        {
            kind: 'category',
            name: 'IA',
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