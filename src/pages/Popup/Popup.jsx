import React, { useEffect } from 'react';

// Import Blockly core.
import * as Blockly from 'blockly/core';
// Import the default blocks.
import * as libraryBlocks from 'blockly/blocks';
// Import a generator.
import { javascriptGenerator } from 'blockly/javascript';
// Import a message file.
import * as En from 'blockly/msg/en';

import './Popup.css';

Blockly.setLocale(En);

const Popup = () => {
  useEffect(() => {
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
        // You can add more blocks to this array.
      ],
    };

    // Inject Blockly into the DOM.
    const workspace = Blockly.inject('blocklyDiv', { toolbox });
  }, []);

  return (
    <div className="App">
      <div id="blocklyDiv" className="blockly-container"></div>
    </div>
  );
};

export default Popup;
