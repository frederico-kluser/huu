import React, { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { removeItem } from "../../../../core/storage";
import isValidUrl from "../../../../helpers/isValidUrl";
import isValidJsonKey from "../../../../helpers/isValidJsonKey";
import { getBlocklyState } from "../../../../blockly";
import { fetchAgentById, saveOrUpdateAgent } from "../../../../core/storageAgents";
import { fetchActualWorkspace, updateActualWorkspace } from "../../../../core/storageWorkspace";
import TypeAgent, { TypeBlock } from "../../../../types/agent";

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
    const agentSelectRef = useRef<HTMLSelectElement>(null);
    const [agentName, setAgentName] = useState('');
    const [agentSite, setAgentSite] = useState('');
    const [isBackButtonDisabled, setIsBackButtonDisabled] = useState(true);

    const canSave = isValidJsonKey(agentName) && isValidUrl(agentSite) && !(agentName !== workspaces[Number(agentSelectRef.current?.value)] && workspaces.includes(agentName));

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

        if (agentName !== workspaces[Number(agentSelectRef.current?.value)]) {
            return true;
        }

        return false;
    };

    useEffect(() => {
        const lastSelectIndex = fetchActualWorkspace();
        const firstWorkspace = workspaces[lastSelectIndex];
        setAgentName(firstWorkspace);
        setAgentSite(fetchAgentById(firstWorkspace)?.urls || '');
        if (agentSelectRef.current) {
            agentSelectRef.current.value = lastSelectIndex.toString();
        }
    }, [workspaces]);

    useEffect(() => {
        if (!canSave) {
            setIsBackButtonDisabled(true);
            return;
        }

        const { blocks } = getBlocklyState(agentName);
        const hasNoBlocks = Object.keys(blocks as TypeBlock).length === 0;
        setIsBackButtonDisabled(hasNoBlocks);
    }, [agentName, agentSite, workspaces]);

    const getWorkspaceName = () => {
        const workspaceIndex: number = Number(agentSelectRef.current?.value) || 0;
        return workspaces[workspaceIndex];
    };

    const handleSave = () => {
        const state = getBlocklyState(agentName);
        const partialAgent: Partial<TypeAgent> = {
            urls: agentSite,
            mode: state.mode || '',
        };

        // TODO: se eu usar o updateAgentPartial não preciso desse "as TypeAgent"
        const newAgentValue: TypeAgent = {
            ...state,
            ...partialAgent,
        } as TypeAgent;

        let localAgentName = "";
        const workspaceName = getWorkspaceName();

        if (workspaceName !== agentName) {
            removeItem(workspaceName);
            const filteredWorkspaces = workspaces.filter((workspace) => workspace !== workspaceName);
            setWorkspaces([...filteredWorkspaces, agentName]);
            localAgentName = agentName;
        } else {
            localAgentName = workspaceName;
        }

        saveOrUpdateAgent(localAgentName, newAgentValue);

        handleGoHome();
    };

    const handleLoadAgent = () => {
        if (!agentSelectRef.current) return;

        const workspaceName = getWorkspaceName();
        setWorkspaceName(workspaceName);
    };

    const handleChangeAgent = () => {
        if (!agentSelectRef.current) return;
        updateActualWorkspace(Number(agentSelectRef.current.value));
        const workspaceName = getWorkspaceName();
        setAgentName(workspaceName);
        const url = fetchAgentById(workspaceName)?.urls || '';
        setAgentSite(url);
    };

    const handleDeleteAgent = () => {
        if (!agentSelectRef.current) return;

        const workspaceName = getWorkspaceName();
        if (!confirm(`Deseja realmente deletar o agente "${workspaceName}"?`)) return;

        updateActualWorkspace(0);
        setWorkspaces(workspaces.filter((workspace) => workspace !== workspaceName));
        setWorkspaceName('');
        removeItem(workspaceName);
    };

    const handleGoHome = () => {
        setIsMainPage(true);
    };

    return (
        <main className="content">
            <button onClick={handleGoHome} disabled={isBackButtonDisabled}>Ativar Agentes</button>
            <select ref={agentSelectRef} onChange={handleChangeAgent}>
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
            <div role="group">
                <button onClick={handleCreateAgent} className="contrast">Criar Novo Agente</button>
                <button onClick={handleSave} disabled={!needToSave()}>Salvar</button>
                <button onClick={handleLoadAgent}>Editar</button>
                <button onClick={handleDeleteAgent}>Deletar</button>
            </div>
        </main>
    );
};

export default EditAgent;