import React, { useEffect } from 'react';

// Import Blockly core.
import * as Blockly from 'blockly/core';
// Import the default blocks.
import * as libraryBlocks from 'blockly/blocks';
// Import a generator.
import { javascriptGenerator } from 'blockly/javascript';
// Import a message file.
import * as PtBr from 'blockly/msg/pt-br';

import blocklyOptions from '../../blockly/config/options';

import './Popup.css';

Blockly.setLocale(PtBr);

const Popup = () => {
  useEffect(() => {
    // Inject Blockly into the DOM.
    const workspace = Blockly.inject('blocklyDiv', blocklyOptions);
    // workspace.updateToolbox(newTree); // Update toolbox
  }, []);

  return (
    <div className="App">
      <div id="blocklyDiv" className="blockly-container"></div>
    </div>
  );
};

export default Popup;
