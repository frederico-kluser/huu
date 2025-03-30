import { BlocklyOptions } from 'blockly';

const blocklyZoom: BlocklyOptions['zoom'] = {
    controls: true,
    wheel: false,
    startScale: 1.0,
    maxScale: 3,
    minScale: 0.3,
    scaleSpeed: 1.2,
    pinch: true,
};

export default blocklyZoom;