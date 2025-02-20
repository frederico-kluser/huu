import React, { useEffect, useRef, useState } from 'react';

import * as Blockly from 'blockly/core';
// Import a message file.
import * as PtBr from 'blockly/msg/pt-br';

import { blocklySetup, loadWorkspace } from '../../blockly';

import '../../assets/css/pico.min.css';
import './Popup.css';
import { getItem, removeItem, setItem } from '../../core/storage';
import keys from '../../types/keys';

Blockly.setLocale(PtBr);

const Popup = () => {
  const [workspaces, setWorkspaces] = useState(getItem(keys.workspace) || []);
  const [workspaceName, setWorkspaceName] = useState('');
  const selectRef = useRef();

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

  const handleLoadAgent = () => {
    const workspaceName = selectRef.current.value;
    setWorkspaceName(workspaceName);
  };

  const handleDeleteAgent = () => {
    const workspaceName = selectRef.current.value;
    setWorkspaces(workspaces.filter((workspace) => workspace !== workspaceName));
    setWorkspaceName('');
    removeItem(workspaceName);
  };

  return (
    <div className="App">
      {workspaceName && (
        <>
          <div id="blocklyDiv" className="blockly-container"></div>
          <div className="content">
            <button onClick={handleSave}>Salvar</button>
          </div>
        </>
      )}
      {!workspaceName && !!workspaces.length && (
        <>
          <select ref={selectRef}>
            {workspaces.map((workspace) => (
              <option key={workspace} value={workspace}>
                {workspace}
              </option>
            ))}
          </select>
          <div role="group">
            <button onClick={handleCreateAgent}>Criar Agente</button>
            <button onClick={handleLoadAgent}>Carregar Agente</button>
            <button onClick={handleDeleteAgent}>Deletar Agente</button>
          </div>
        </>
      )}
      {!workspaceName && !workspaces.length && (
        <div>
          <h1>Nenhum agente criado</h1>
          <button onClick={handleCreateAgent}>Criar Agente</button>
        </div>
      )}
    </div>
  );
};

export default Popup;
