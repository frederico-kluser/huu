import React, { useEffect, useState } from 'react';
import * as Blockly from 'blockly/core';
import * as PtBr from 'blockly/msg/pt-br';
import { blocklySetup, loadWorkspace } from '../../blockly';

import MainPage from './pages/MainPage';
import EditAgent from './pages/EditAgent';
import CreateAgent from './pages/CreateAgent';
import isValidJsonKey from '../../helpers/isValidJsonKey';
import { fetchWorkspaceNames, updateActualWorkspace, updateWorkspaceNames } from '../../core/storage/workspace';

import '../../assets/css/pico.min.css';
import './Popup.css';
import { fetchPopupNavigation, updatePopupNavigation } from '../../core/storage/popupNavigation';
import { createAgent } from '../../core/storage/agents';
import isValidUrlPatterns from '../../helpers/isValidPatterns';

Blockly.setLocale(PtBr as any);

const Popup = () => {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [actualWorkspace, setActualWorkspace] = useState('');
  const [isMainPage, setIsMainPage] = useState(false);

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      console.log("tab.url");
      console.log(tab.url);
      console.log("tab");
      console.log(tab);
    });

    fetchWorkspaceNames().then((loadedWorkspaces) => {
      setWorkspaces(loadedWorkspaces);
      setIsMainPage(!actualWorkspace && !!loadedWorkspaces.length);
    });

    fetchPopupNavigation().then((navigation) => {
      setActualWorkspace(navigation);
    });
  }, []);

  useEffect(() => {
    updateWorkspaceNames(workspaces).then(() => {
      console.log('Workspaces atualizados');
    });
  }, [workspaces]);

  useEffect(() => {
    updatePopupNavigation(actualWorkspace);
    if (!actualWorkspace) return;

    blocklySetup();
    // Foi melhor separar, porque assim posso carregar o workspace que quiser
    loadWorkspace(actualWorkspace);
  }, [actualWorkspace]);

  const handleBack = () => {
    setActualWorkspace('');
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

    const URLs = prompt('Digite um padrão de URL. \n\nPara criar padrões de URL, basta escrever o domínio e o caminho, usando o caractere * onde quiser aceitar qualquer parte variável. Por exemplo, exemplo.com/* permite combinar tudo que esteja em “exemplo.com” sem se preocupar com o que vem depois da barra. Se quiser abranger subdomínios, faça algo como *.exemplo.com/*, que vale para qualquer coisa antes de “.exemplo.com”. Você pode escrever vários padrões separados por vírgula; por exemplo, exemplo.com/*, outro.com/pasta/* cobre “exemplo.com” e qualquer página na pasta “pasta” de “outro.com”.', 'google.com/*');
    if (!URLs) return;
    if (!isValidUrlPatterns(URLs)) {
      alert('URL inválida');
      return;
    }

    await createAgent(workspaceName, URLs);
    setWorkspaces([...workspaces, workspaceName]);
    setActualWorkspace(workspaceName);
    await updateActualWorkspace(workspaces.length);
  };

  return (
    <div className="App">
      {actualWorkspace && (
        <>
          <div id="blocklyDiv" className="blockly-container"></div>
          <div className="blockly-content">
            <button onClick={handleBack}>Voltar</button>
          </div>
        </>
      )}
      {!actualWorkspace && !!workspaces.length &&
        (isMainPage ? (
          <MainPage
            setIsMainPage={setIsMainPage}
            workspaces={workspaces}
            handleCreateAgent={handleCreateAgent}
          />) : <EditAgent
          handleCreateAgent={handleCreateAgent}
          setIsMainPage={setIsMainPage}
          setActualWorkspace={setActualWorkspace}
          setWorkspaces={setWorkspaces}
          workspaces={workspaces}
        />)
      }
      {!actualWorkspace && !workspaces.length && (
        <CreateAgent
          handleCreateAgent={handleCreateAgent}
        />
      )}
    </div>
  );
};

export default Popup;
