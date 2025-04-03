import React, { useEffect, useState } from 'react';
import * as Blockly from 'blockly/core';
import * as PtBr from 'blockly/msg/pt-br';
import { blocklySetup, loadWorkspace } from '../../blockly';

import MainPage from './pages/MainPage';
import EditAgent from './pages/EditAgent';
import CreateAgent from './pages/CreateAgent';
import isValidJsonKey from '../../helpers/isValidJsonKey';
import { fetchWorkspaceNames, updateActualWorkspace, updateWorkspaceNames } from '../../core/storage/workspace';

import 'bootstrap-dark-5/dist/css/bootstrap-dark.min.css';
import './Popup.css';
import { fetchPopupNavigation, updatePopupNavigation } from '../../core/storage/popupNavigation';
import { createFullAgent, createNewAgent } from '../../core/storage/agents';
import isValidUrlPatterns from '../../helpers/isValidPatterns';
import TypeAgent from '../../types/agent';
import { setupAlertReplacement, showAlert } from '../../helpers/ui/showAlert';

Blockly.setLocale(PtBr as any);

const Popup = () => {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [actualWorkspace, setActualWorkspace] = useState('');
  const [isMainPage, setIsMainPage] = useState(false);
  const [isLargeMode, setIsLargeMode] = useState(false);

  useEffect(() => {
    // Configurar substituição do alert
    setupAlertReplacement();
    
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

    const params = new URLSearchParams(window.location.search);
    const layoutParam = params.get('large');

    console.log('layoutParam', layoutParam);
    if (layoutParam) {
      setIsLargeMode(true);

      // Criar elemento de estilo
      const style = document.createElement('style');
      style.textContent = `
      body,
      .App,
      .blockly-container {
          max-width: initial !important;
          max-height: initial !important;
          width: 100vw !important;
          height: 100vh !important;
      }
    `;

      // Adicionar ao head para ter alta prioridade
      document.head.appendChild(style);
      console.log('Modo grande ativado');
      console.log(style);
    }
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

  const lunchLargeMode = () => {
    chrome.tabs.create({ url: "popup.html?large=true" });
  };

  const handleCreateAgent = async () => {
    const workspaceName = prompt('Digite o nome do agente', 'Agente 1');
    if (!workspaceName) return;

    if (!isValidJsonKey(workspaceName)) {
      showAlert('Nome inválido', 'danger');
      return;
    }

    if (workspaces.includes(workspaceName)) {
      showAlert('Já existe um agente com esse nome', 'warning');
      return;
    }

    const URLs = prompt('Digite um padrão de URL. \n\nPara criar padrões de URL, basta escrever o domínio e o caminho, usando o caractere * onde quiser aceitar qualquer parte variável. Por exemplo, exemplo.com/* permite combinar tudo que esteja em “exemplo.com” sem se preocupar com o que vem depois da barra. Se quiser abranger subdomínios, faça algo como *.exemplo.com/*, que vale para qualquer coisa antes de “.exemplo.com”. Você pode escrever vários padrões separados por vírgula; por exemplo, exemplo.com/*, outro.com/pasta/* cobre “exemplo.com” e qualquer página na pasta “pasta” de “outro.com”.', 'google.com/*');
    if (!URLs) return;
    if (!isValidUrlPatterns(URLs)) {
      showAlert('URL inválida', 'danger');
      return;
    }

    await createNewAgent(workspaceName, URLs);
    setWorkspaces([...workspaces, workspaceName]);
    setActualWorkspace(workspaceName);
    await updateActualWorkspace(workspaces.length);
    showAlert('Agente criado com sucesso', 'success');
  };

  const handleCreateFullAgent = async (agent: TypeAgent) => {
    if (!isValidJsonKey(agent.name)) {
      showAlert('Nome inválido', 'danger');
      return;
    }
    if (workspaces.includes(agent.name)) {
      showAlert('Já existe um agente com esse nome', 'warning');
      return;
    }
    if (!isValidUrlPatterns(agent.urls)) {
      showAlert('URL inválida', 'danger');
      return;
    }

    await createFullAgent(agent);
    setWorkspaces([...workspaces, agent.name]);
    setActualWorkspace(agent.name);
    await updateActualWorkspace(workspaces.length);
    showAlert('Agente criado com sucesso', 'success');
  };

  return (
    <div className="App">
      {actualWorkspace && (
        <>
          <div id="blocklyDiv" data-testid="blocklyDiv" className="blockly-container"></div>
          <div className="blockly-content">
            <button onClick={handleBack} className="btn btn-primary">Voltar</button>
            {!isLargeMode && (
              <button onClick={lunchLargeMode} className="btn btn-secondary">
                Abrir modo grande
              </button>
            )}
          </div>
        </>
      )}
      {!actualWorkspace && !!workspaces.length &&
        (isMainPage ? (
          <MainPage
            setIsMainPage={setIsMainPage}
            workspaces={workspaces}
            handleCreateAgent={handleCreateAgent}
            handleCreateFullAgent={handleCreateFullAgent}
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
