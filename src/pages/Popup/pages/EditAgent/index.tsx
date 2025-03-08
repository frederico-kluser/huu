import React, { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import isValidJsonKey from "../../../../helpers/isValidJsonKey";
import { getBlocklyState } from "../../../../blockly";
import { fetchActualWorkspace, updateActualWorkspace } from "../../../../core/storage/workspace";
import TypeAgent, { TypeBlock } from "../../../../types/agent";
import isValidPatterns from "../../../../helpers/isValidPatterns";
import { removeItem } from "../../../../core/storage";
import { fetchAgentById, saveOrUpdateAgent } from "../../../../core/storage/agents";

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

    const canSave = isValidJsonKey(agentName) && isValidPatterns(agentSite) && !(agentName !== workspaces[Number(agentSelectRef.current?.value)] && workspaces.includes(agentName));

    const needToSave = async () => {
        if (!canSave) {
            return false;
        }

        const agentItem = await fetchAgentById(agentName);

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
        fetchActualWorkspace().then((lastSelectIndex) => {
            const firstWorkspace = workspaces[lastSelectIndex];
            setAgentName(firstWorkspace);
            fetchAgentById(firstWorkspace).then((agent) => {
                const { urls } = agent || { urls: '' };
                setAgentSite(urls);
                if (agentSelectRef.current) {
                    agentSelectRef.current.value = lastSelectIndex.toString();
                }
            });
        });
    }, [workspaces]);

    useEffect(() => {
        if (!canSave) {
            setIsBackButtonDisabled(true);
            return;
        }

        getBlocklyState(agentName).then(({ blocks }) => {
            const hasNoBlocks = Object.keys(blocks as TypeBlock).length === 0;
            setIsBackButtonDisabled(hasNoBlocks);
        });
    }, [agentName, agentSite, workspaces]);

    const getWorkspaceName = () => {
        const workspaceIndex: number = Number(agentSelectRef.current?.value) || 0;
        return workspaces[workspaceIndex];
    };

    const handleSave = async () => {
        const state = await getBlocklyState(agentName);
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

    const handleChangeAgent = async () => {
        console.log("agentSelectRef.current", agentSelectRef.current);
        if (!agentSelectRef.current) return;
        updateActualWorkspace(Number(agentSelectRef.current.value));
        const workspaceName = getWorkspaceName();
        setAgentName(workspaceName);
        const agentItem = await fetchAgentById(workspaceName);
        const url = agentItem?.urls || '';
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
            <button onClick={handleGoHome} disabled={isBackButtonDisabled}>Voltar</button>
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
            }} aria-invalid={!isValidPatterns(agentSite)} />
            <small>Para criar padrões de URL, basta escrever o domínio e o caminho, usando o caractere <code>*</code> onde quiser aceitar qualquer parte variável. Por exemplo, <code>exemplo.com/*</code> permite combinar tudo que esteja em “exemplo.com” sem se preocupar com o que vem depois da barra. Se quiser abranger subdomínios, faça algo como <code>*.exemplo.com/*</code>, que vale para qualquer coisa antes de “.exemplo.com”. Você pode escrever vários padrões separados por vírgula; por exemplo, <code>exemplo.com/*, outro.com/pasta/*</code> cobre “exemplo.com” e qualquer página na pasta “pasta” de “outro.com”.</small>
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