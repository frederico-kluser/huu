import React, { useEffect } from 'react';

import * as Blockly from 'blockly/core';
// Import a message file.
import * as PtBr from 'blockly/msg/pt-br';

import { blocklySetup, loadWorkspace } from '../../blockly';

import './Popup.css';

Blockly.setLocale(PtBr);

const Popup = () => {
  useEffect(() => {
    blocklySetup();
    loadWorkspace();
  }, []);

  return (
    <div className="App">
      <div id="blocklyDiv" className="blockly-container"></div>
    </div>
  );
};

export default Popup;
