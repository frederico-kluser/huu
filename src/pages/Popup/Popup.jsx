import React, { useEffect, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import * as PtBr from 'blockly/msg/pt-br';
import { blocklySetup, loadWorkspace } from '../../blockly';

import EditAgent from './pages/EditAgent';
import CreateAgent from './pages/CreateAgent';
import { getItem, setItem } from '../../core/storage';
import keys from '../../types/keys';

import '../../assets/css/pico.min.css';
import './Popup.css';

Blockly.setLocale(PtBr);

const Popup = () => {
  const [workspaces, setWorkspaces] = useState(getItem(keys.workspace) || []);
  const [workspaceName, setWorkspaceName] = useState('');

  useEffect(() => {
    setItem(keys.workspace, workspaces);
  }, [workspaces]);

  useEffect(() => {
    if (!workspaceName) return;

    blocklySetup();
    // Foi melhor separar, porque assim posso carregar o workspace que quiser
    loadWorkspace(workspaceName);
  }, [workspaceName]);

  const handleSave = () => {
    setWorkspaceName('');
  };

  const handleCreateAgent = () => {
    const workspaceName = prompt('Digite o nome do agente', 'Agente 1');
    if (!workspaceName) return;
    // TODO: validar se já existe um agente com esse nome
    // TODO: validar se o nome é válido
    setWorkspaces([...workspaces, workspaceName]);
    setWorkspaceName(workspaceName);
  };

  return (
    <div className="App">
      {workspaceName && (
        <>
          <div id="blocklyDiv" className="blockly-container"></div>
          <div className="blockly-content">
            <button onClick={handleSave}>Salvar</button>
          </div>
        </>
      )}
      {!workspaceName && !!workspaces.length &&
        <EditAgent
          setWorkspaceName={setWorkspaceName}
          handleCreateAgent={handleCreateAgent}
          workspaces={workspaces}
          setWorkspaces={setWorkspaces}
        />
      }
      {!workspaceName && !workspaces.length && (
        <CreateAgent
          setWorkspaceName={setWorkspaceName}
          workspaces={workspaces}
          setWorkspaces={setWorkspaces}
        />
      )}
    </div>
  );
};

export default Popup;
