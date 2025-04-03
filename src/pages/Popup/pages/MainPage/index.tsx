import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import isValidAgent from '../../../../helpers/isValidAgent';
import TypeAgent, { TypeMode } from '../../../../types/agent';
import Colors from '../../../../types/colors';
import TypePageStyle from '../../../../types/pageStyle';
import { fetchAgentById, updateAgentAttributes } from '../../../../core/storage/agents';
import urlMatchesPattern from '../../../../helpers/urlMatchePattern';
import Gap from '../../../../components/Gap';
import importJsonAgent from '../../../../helpers/importJsonAgent';
import { getItem, setItem } from '../../../../core/storage';
import enums from '../../../../types/enums';
import validateOpenAIApiKey from '../../../../helpers/validateOpenAiApiKey';

interface MainPageProps {
    setIsMainPage: Dispatch<SetStateAction<boolean>>
    workspaces: string[]
    handleCreateAgent: () => Promise<void>
    handleCreateFullAgent: (agent: TypeAgent) => Promise<void>
}

const MainPage = ({ setIsMainPage, workspaces, handleCreateAgent, handleCreateFullAgent }: MainPageProps) => {
    const [validatedAgents, setValidatedAgents] = useState<string[]>([]);
    const [agentItems, setAgentItems] = useState<JSX.Element[]>([]);
    const [url, setUrl] = useState<string>('');
    const [openaiKey, setOpenaiKey] = useState<string>('');
    const [showApiKeyManager, setShowApiKeyManager] = useState<boolean>(false);
    const [newApiKey, setNewApiKey] = useState<string>('');
    const [apiKeyStatus, setApiKeyStatus] = useState<string>('');
    const [isValidatingKey, setIsValidatingKey] = useState<boolean>(false);

    useEffect(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            // tabs[0] contém informações sobre a aba ativa
            var currentTab = tabs[0];
            // Exibir a URL no elemento com id "url"
            setUrl(currentTab.url || 'url não encontrada');
        });
        
        // Carregar a chave da OpenAI
        const loadOpenAIKey = async () => {
            const key = await getItem<string>(enums.OPENAI_KEY);
            setOpenaiKey(key || '');
        };
        
        loadOpenAIKey();
    }, []);

    const updateApprovedAgents = async () => {
        const localApprovedAgents: string[] = [];

        for (let i = 0; i < workspaces.length; i++) {
            const workspace = workspaces[i];

            if (await isValidAgent(workspace)) {
                localApprovedAgents.push(workspace);
            }
        }

        setValidatedAgents(localApprovedAgents);
    }

    useEffect(() => {
        updateApprovedAgents();
    }, [workspaces]);

    const getButton = async (agentName: string) => {
        const agent = await fetchAgentById(agentName);
        const active = !!agent?.active;

        return (
            <button onClick={() => {
                updateAgentAttributes(agentName, {
                    active: !active,
                });

                updateApprovedAgents();
            }} className={active ? "btn btn-success" : "btn btn-danger"} style={active ? styles.agentActivateButton : styles.agentDeactivateButton}>{active ? 'Desativar' : 'Ativar'}</button>
        );
    };

    const handleEditMode = async (agentName: string, mode: TypeMode) => {
        await updateAgentAttributes(agentName, {
            mode,
        });

        await updateApprovedAgents();
    };

    const generateAgentElements = async () => {
        const localAgentUIElements: JSX.Element[] = [];

        for (let i = 0; i < validatedAgents.length; i++) {
            const agent = validatedAgents[i];
            const retrievedAgent = await fetchAgentById(agent);
            const mode = retrievedAgent?.mode;

            if (urlMatchesPattern(url, retrievedAgent?.urls || '')) {
                localAgentUIElements.push(
                    <div role="group" key={agent} style={styles.agentItem}>
                        {await getButton(agent)}
                        <h6 style={styles.agentTitle}>{agent}</h6>
                        <select className="form-select" onChange={(e) => handleEditMode(agent, e.target.value as TypeMode)} value={mode}>
                            <option value="">Selecione o modo de acionamento</option>
                            <option value="automatic-1">Acionar automaticamente uma vez</option>
                            <option value="automatic">Acionar automaticamente sem parar</option>
                            <option value="manual-shortcut-2">Manual pelo atalho Ctrl + 2</option>
                            <option value="manual-shortcut-3">Manual pelo atalho Ctrl + 3</option>
                            <option value="manual-shortcut-4">Manual pelo atalho Ctrl + 4</option>
                            <option value="manual-shortcut-5">Manual pelo atalho Ctrl + 5</option>
                            <option value="manual-shortcut-6">Manual pelo atalho Ctrl + 6</option>
                            <option value="manual-shortcut-7">Manual pelo atalho Ctrl + 7</option>
                            <option value="manual-shortcut-8">Manual pelo atalho Ctrl + 8</option>
                            <option value="manual-shortcut-9">Manual pelo atalho Ctrl + 9</option>
                        </select>
                    </div>
                );
            }
        }

        setAgentItems(localAgentUIElements);
    };

    useEffect(() => {
        generateAgentElements()
    }, [validatedAgents]);

    const handleEditModels = () => {
        setIsMainPage(false);
    };

    const handleImportJsonAgent = async () => {
        importJsonAgent().then((importedAgent) => {
            handleCreateFullAgent(importedAgent);
        }).catch((error) => {
            console.error('Erro ao importar agente:', error);
            alert('Erro ao importar agente: ' + error.message);
        });
    };
    
    const toggleApiKeyManager = () => {
        setShowApiKeyManager(!showApiKeyManager);
        setNewApiKey(openaiKey || '');
        setApiKeyStatus('');
    };
    
    const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setNewApiKey(e.target.value);
        setApiKeyStatus('');
    };
    
    const saveApiKey = async () => {
        if (!newApiKey) {
            setApiKeyStatus('error');
            return;
        }
        
        setIsValidatingKey(true);
        
        try {
            const isValid = await validateOpenAIApiKey(newApiKey);
            
            if (isValid) {
                await getItem(enums.OPENAI_KEY);
                await setItem(enums.OPENAI_KEY, newApiKey);
                setOpenaiKey(newApiKey);
                setShowApiKeyManager(false);
                setApiKeyStatus('');
                alert('Chave da OpenAI atualizada com sucesso!');
            } else {
                setApiKeyStatus('error');
                alert('Chave da OpenAI inválida!');
            }
        } catch (error) {
            console.error('Erro ao validar chave:', error);
            setApiKeyStatus('error');
        } finally {
            setIsValidatingKey(false);
        }
    };

    return (
        <div style={styles.container}>
            <h1>huu</h1>
            {validatedAgents.length === 0 && <h4>Nenhum agente criado</h4>}
            {validatedAgents.length > 0 && <p>Agentes para este site<br /><mark><i>{url}</i></mark></p>}
            <div style={styles.agentContainer}>
                {agentItems}
            </div>
            <Gap horizontal size={16}>
                <button onClick={handleEditModels} className="btn btn-primary">Editar Agentes</button>
                <button onClick={handleCreateAgent} className="btn btn-dark">Criar Novo Agente</button>
                <button onClick={handleImportJsonAgent} className="btn btn-secondary">Importar Agente</button>
                <button onClick={toggleApiKeyManager} className="btn btn-info">Gerenciar API Key</button>
            </Gap>
            
            {showApiKeyManager && (
                <div className="mt-4 p-3 border rounded" style={{ width: '100%', maxWidth: '600px' }}>
                    <h4>Gerenciar API Key da OpenAI</h4>
                    <p>Sua chave atual: {openaiKey ? '••••••••' + openaiKey.substring(openaiKey.length - 4) : 'Não configurada'}</p>
                    
                    <div className="mb-3">
                        <label htmlFor="apiKeyInput" className="form-label">Nova API Key:</label>
                        <input 
                            type="password" 
                            id="apiKeyInput"
                            className={`form-control ${apiKeyStatus === 'error' ? 'is-invalid' : ''}`}
                            value={newApiKey} 
                            onChange={handleApiKeyChange}
                            disabled={isValidatingKey}
                        />
                        {apiKeyStatus === 'error' && (
                            <div className="invalid-feedback">
                                Chave inválida! Verifique e tente novamente.
                            </div>
                        )}
                    </div>
                    
                    <div className="d-flex justify-content-end gap-2">
                        <button 
                            className="btn btn-secondary" 
                            onClick={toggleApiKeyManager}
                            disabled={isValidatingKey}
                        >
                            Cancelar
                        </button>
                        <button 
                            className="btn btn-primary" 
                            onClick={saveApiKey}
                            disabled={isValidatingKey}
                        >
                            {isValidatingKey ? (
                                <>
                                    <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                    Validando...
                                </>
                            ) : 'Salvar Nova Chave'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
};

const styles: TypePageStyle = {
    agentActivateButton: {
        backgroundColor: Colors.green500,
        maxWidth: '300px',
        width: '300px',
    },
    agentDeactivateButton: {
        backgroundColor: Colors.red500,
        maxWidth: '300px',
        width: '300px',
    },
    agentItem: {
        border: '1px solid white',
    },
    agentContainer: {
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '800px',
        overflow: 'hidden',
        padding: '16px',
    },
    agentTitle: {
        color: "#fff",
        lineHeight: '56px',
        width: '75%',
    },
    container: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
    }
}

export default MainPage;