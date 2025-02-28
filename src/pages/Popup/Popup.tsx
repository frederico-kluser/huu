import React, { useEffect, useState } from 'react';
import * as Blockly from 'blockly/core';
import * as PtBr from 'blockly/msg/pt-br';
import { blocklySetup, loadWorkspace } from '../../blockly';

import MainPage from './pages/MainPage';
import EditAgent from './pages/EditAgent';
import CreateAgent from './pages/CreateAgent';

import '../../assets/css/pico.min.css';
import './Popup.css';
import isValidJsonKey from '../../helpers/isValidJsonKey';
import { fetchWorkspaceNames, updateActualWorkspace, updateWorkspaceNames } from '../../core/storageWorkspace';
import { messageListener } from '../../core/message';

Blockly.setLocale(PtBr as any);

const Popup = () => {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState('');
  const [isMainPage, setIsMainPage] = useState(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      console.log(tab.url);
    });

    messageListener.popup();

    fetchWorkspaceNames().then((loadedWorkspaces) => {
      setWorkspaces(loadedWorkspaces);
      setIsMainPage(!workspaceName && !!loadedWorkspaces.length);
    });
  }, []);

  useEffect(() => {
    updateWorkspaceNames(workspaces).then(() => {
      console.log('Workspaces atualizados');
    });
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

  const handleCreateAgent = async () => {
    const workspaceName = prompt('Digite o nome do agente', 'Agente 1');
    if (!workspaceName) return;
    if (!isValidJsonKey(workspaceName)) {
      alert('Nome inválido');
      return;
    }

    if (workspaces.includes(workspaceName)) {
      alert('Já existe um agente com esse nome');
      return;
    }

    setWorkspaces([...workspaces, workspaceName]);
    setWorkspaceName(workspaceName);
    await updateActualWorkspace(workspaces.length);
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
        (isMainPage ? (<>
          <MainPage
            setIsMainPage={setIsMainPage}
            workspaces={workspaces}
          />
          <button onClick={() => {
            chrome.runtime.sendMessage(
              { from: 'popup', data: 'Mensagem do Popup para o Background' },
              (response) => {
                console.log('Popup recebeu resposta do Background:', response.data);
              },
            );
          }}>testar mensageria</button>
        </>) : <EditAgent
          handleCreateAgent={handleCreateAgent}
          setIsMainPage={setIsMainPage}
          setWorkspaceName={setWorkspaceName}
          setWorkspaces={setWorkspaces}
          workspaces={workspaces}
        />)
      }
      {!workspaceName && !workspaces.length && (
        <CreateAgent
          handleCreateAgent={handleCreateAgent}
        />
      )}
    </div>
  );
};

export default Popup;
