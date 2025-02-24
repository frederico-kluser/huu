import React, { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react';
import { removeItem } from '../../../../core/storage';
import isValidUrl from '../../../../helpers/isValidUrl';
import isValidJsonKey from '../../../../helpers/isValidJsonKey';
import { getBlocklyState } from '../../../../blockly';
import { fetchAgentById, saveOrUpdateAgent } from '../../../../core/storageAgents';
import { fetchActualWorkspace, updateActualWorkspace } from '../../../../core/storageWorkspace';

interface EditAgentProps {
    handleCreateAgent: () => void
    setIsMainPage: Dispatch<SetStateAction<boolean>>
    setWorkspaceName: Dispatch<SetStateAction<string>>
    setWorkspaces: Dispatch<SetStateAction<string[]>>
    workspaces: string[]
}

const EditAgent = ({
    handleCreateAgent,
    setIsMainPage,
    setWorkspaceName,
    setWorkspaces,
    workspaces,
}: EditAgentProps
) => {
    const selectRef = useRef<HTMLSelectElement>(null);
    const [agentName, setAgentName] = useState('');
    const [agentSite, setAgentSite] = useState('');
    const [isBackButtonDisabled, setIsBackButtonDisabled] = useState(true);

    const canSave = isValidJsonKey(agentName) && isValidUrl(agentSite) && !(agentName !== workspaces[Number(selectRef.current?.value)] && workspaces.includes(agentName));

    const needToSave = () => {
        if (!canSave) {
            return false;
        }

        const agentItem = fetchAgentById(agentName);

        if (!agentItem) {
            return true;
        }

        if (agentItem.urls !== agentSite) {
            return true;
        }

        if (agentName !== workspaces[Number(selectRef.current?.value)]) {
            return true;
        }

        return false;
    };

    useEffect(() => {
        const lastSelectIndex = fetchActualWorkspace();
        const firstWorkspace = workspaces[lastSelectIndex];
        setAgentName(firstWorkspace);
        setAgentSite(fetchAgentById(firstWorkspace)?.urls || '');
        if (selectRef.current) {
            selectRef.current.value = lastSelectIndex.toString();
        }
    }, [workspaces]);

    useEffect(() => {
        if (!canSave) {
            setIsBackButtonDisabled(true);
            return;
        }

        const state = getBlocklyState(agentName);
        const hasNoBlocks = Object.keys(state.blocks).length === 0;
        setIsBackButtonDisabled(hasNoBlocks);
    }, [agentName, agentSite, workspaces]);

    const getWorkspaceName = () => {
        const workspaceIndex: number = Number(selectRef.current?.value) || 0;
        return workspaces[workspaceIndex];
    };

    const handleSave = () => {
        const state = getBlocklyState(agentName);
        const workspaceName = getWorkspaceName();

        if (workspaceName !== agentName) {
            removeItem(workspaceName);
            const filteredWorkspaces = workspaces.filter((workspace) => workspace !== workspaceName);
            setWorkspaces([...filteredWorkspaces, agentName]);

            saveOrUpdateAgent(agentName, {
                ...state,
                urls: agentSite,
            });
        } else {
            saveOrUpdateAgent(workspaceName, {
                ...state,
                urls: agentSite,
            });
        }

        handleBack();
    };

    const handleLoadAgent = () => {
        if (!selectRef.current) return;

        const workspaceName = getWorkspaceName();
        setWorkspaceName(workspaceName);
    };

    const handleChangeAgent = () => {
        if (!selectRef.current) return;
        updateActualWorkspace(Number(selectRef.current.value));
        const workspaceName = getWorkspaceName();
        setAgentName(workspaceName);
        const url = fetchAgentById(workspaceName)?.urls || '';
        setAgentSite(url);
    };

    const handleDeleteAgent = () => {
        if (!selectRef.current) return;

        const workspaceName = getWorkspaceName();
        if (!confirm(`Deseja realmente deletar o agente "${workspaceName}"?`)) return;

        updateActualWorkspace(0);
        setWorkspaces(workspaces.filter((workspace) => workspace !== workspaceName));
        setWorkspaceName('');
        removeItem(workspaceName);
    };

    const handleBack = () => {
        setIsMainPage(true);
    };

    return (
        <main className="content">
            <button onClick={handleBack} disabled={isBackButtonDisabled}>Voltar</button>
            {(isBackButtonDisabled) && (
                <mark>
                    <i>
                        <small style={{
                        }}>O seu agente não tem nenhuma ação cadastrada, por favor clique em Editar para adicionar ações</small>
                    </i>
                </mark>)}
            <select ref={selectRef} onChange={handleChangeAgent}>
                {workspaces.map((workspace, index) => (
                    <option key={workspace} value={index}>
                        {workspace}
                    </option>
                ))}
            </select>
            <input type="text" placeholder="Nome do agente" value={agentName} onChange={(e) => {
                setAgentName(e.target.value);
            }} aria-invalid={!isValidJsonKey(agentName)} />
            <input type="text" placeholder="Site que o agente irá funcionar" value={agentSite} onChange={(e) => {
                setAgentSite(e.target.value);
            }} aria-invalid={!isValidUrl(agentSite)} />
            {/* <select> TODO: posso definir na tela principal do agente
          <option>Acionar manual</option>
          <option>Acionar automatico</option>
          <option>Acionar com Ctrl + 2</option>
          <option>Acionar com Ctrl + 3</option>
          <option>Acionar com Ctrl + 4</option>
          <option>Acionar com Ctrl + 5</option>
          <option>Acionar com Ctrl + 6</option>
          <option>Acionar com Ctrl + 7</option>
          <option>Acionar com Ctrl + 8</option>
          <option>Acionar com Ctrl + 9</option>
        </select> */}
            <div role="group">
                {/* <button onClick={handleCreateAgent}>Criar Novo Agente</button> */}
                <button onClick={handleCreateAgent}>Criar</button>
                <button onClick={handleSave} disabled={!needToSave()}>Salvar</button>
                <button onClick={handleLoadAgent}>Editar</button>
                <button onClick={handleDeleteAgent}>Deletar</button>
            </div>
        </main>
    );
};

export default EditAgent;