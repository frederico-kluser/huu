import * as Blockly from 'blockly';
import { BlocklyOptions } from 'blockly';
import blocklyTheme from './theme';
import blocklyToolbox from './toolbox';
import blocklyZoom from './zoom';
import blocklyMove from './move';
import blocklyGrid from './grid';

const blocklyOptions: BlocklyOptions = {
  collapse: true, // Allow the user to collapse blocks.
  comments: true, // Enable comments.
  grid: blocklyGrid, // Enable grid and snap to grid.
  maxBlocks: Infinity, // Max blocks in workspace.
  maxTrashcanContents: 32, // The maximum number of deleted items to store in the trashcan.
  move: blocklyMove, // Enable workspace move.
  readOnly: false, // Enable read-only mode.
  renderer: 'geras', // Os renderizadores pré-empacotados incluem "geras" (o padrão), "thrasos" e "zelos" (um renderizador semelhante a scratch)
  scrollbars: true, // Enable horizontal and vertical scrollbars.
  sounds: true, // Enable sounds.
  toolbox: blocklyToolbox, // Use the provided toolbox.
  toolboxPosition: 'start', // Position of the toolbox.
  trashcan: true, // Enable the trashcan.
  zoom: blocklyZoom, // Zoom the blocks.
  theme: blocklyTheme,
};

export default blocklyOptions;
