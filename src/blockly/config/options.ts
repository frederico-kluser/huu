import { BlocklyOptions } from 'blockly';

const blocklyOptions: BlocklyOptions = {
  grid: { spacing: 20, length: 3, colour: '#ccc', snap: true },
  maxBlocks: Infinity,
  sounds: true,
  toolbox: {
    kind: 'flyoutToolbox',
    contents: [
      {
        kind: 'block',
        type: 'controls_if',
      },
      {
        kind: 'block',
        type: 'controls_whileUntil',
      },
      // You can add more blocks to this array.
    ],
  },
  trashcan: true,
};

export default blocklyOptions;
