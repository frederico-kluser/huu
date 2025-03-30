import { BlocklyOptions } from 'blockly';

const blocklyMove: BlocklyOptions['move'] = {
    scrollbars: {
        horizontal: true,
        vertical: true,
    },
    drag: true,
    wheel: false,
};

export default blocklyMove;