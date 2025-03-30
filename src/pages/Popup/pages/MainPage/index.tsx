import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import isValidAgent from '../../../../helpers/isValidAgent';
import TypeAgent, { TypeMode } from '../../../../types/agent';
import Colors from '../../../../types/colors';
import TypePageStyle from '../../../../types/pageStyle';
import { fetchAgentById, updateAgentAttributes } from '../../../../core/storage/agents';
import urlMatchesPattern from '../../../../helpers/urlMatchePattern';
import Gap from '../../../../components/Gap';
import importJsonAgent from '../../../../helpers/importJsonAgent';

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

    useEffect(() => {
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
            // tabs[0] contém informações sobre a aba ativa
            var currentTab = tabs[0];
            // Exibir a URL no elemento com id "url"
            setUrl(currentTab.url || 'url não encontrada');
        });
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
            }} style={active ? styles.agentActivateButton : styles.agentDeactivateButton}>{active ? 'Desativar' : 'Ativar'}</button>
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
                        <select onChange={(e) => handleEditMode(agent, e.target.value as TypeMode)} value={mode}>
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

    return (
        <div style={styles.container}>
            <h1>huu</h1>
            {validatedAgents.length === 0 && <h4>Nenhum agente criado</h4>}
            {validatedAgents.length > 0 && <p>Agentes para este site<br /><mark><i>{url}</i></mark></p>}
            <div style={styles.agentContainer}>
                {agentItems}
            </div>
            <Gap horizontal size={16}>
                <button onClick={handleEditModels}>Editar Agentes</button>
                <button onClick={handleCreateAgent} className="contrast">Criar Novo Agente</button>
                <button onClick={handleImportJsonAgent} className="secondary">Importar Agente</button>
            </Gap>
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