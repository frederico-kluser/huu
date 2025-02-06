import { BlocklyOptions } from 'blockly';

const grid = {
  spacing: 20,
  length: 3,
  colour: '#ccc',
  snap: true,
};

const move = {
  scrollbars: {
    horizontal: true,
    vertical: true,
  },
  drag: true,
  wheel: false,
};

const toolbox = {
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
  ],
};

const zoom = {
  controls: true,
  wheel: false,
  startScale: 1.0,
  maxScale: 3,
  minScale: 0.3,
  scaleSpeed: 1.2,
  pinch: true,
};

const blocklyOptions: BlocklyOptions = {
  collapse: true, // Allow the user to collapse blocks.
  comments: true, // Enable comments.
  grid, // Enable grid and snap to grid.
  maxBlocks: Infinity, // Max blocks in workspace.
  maxTrashcanContents: 32, // The maximum number of deleted items to store in the trashcan.
  move,
  readOnly: false, // Enable read-only mode.
  renderer: 'zelos', // Os renderizadores pré-empacotados incluem "geras" (o padrão), "thrasos" e "zelos" (um renderizador semelhante a scratch)
  scrollbars: true, // Enable horizontal and vertical scrollbars.
  sounds: true, // Enable sounds.
  toolbox,
  toolboxPosition: 'start', // Position of the toolbox.
  trashcan: true, // Enable the trashcan.
  zoom,
};

export default blocklyOptions;
