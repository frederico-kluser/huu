import React, { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import isValidJsonKey from "../../../../helpers/isValidJsonKey";
import { getBlocklyState } from "../../../../blockly";
import { fetchActualWorkspaceIndex, updateActualWorkspace } from "../../../../core/storage/workspace";
import TypeAgent, { TypeBlock } from "../../../../types/agent";
import isValidUrlPatterns from "../../../../helpers/isValidPatterns";
import { removeItem } from "../../../../core/storage";
import { fetchAgentById, updateOrCreateAgent } from "../../../../core/storage/agents";
import exportObjectAsJson from "../../../../helpers/exportObjectAsJson";
import { showAlert } from "../../../../helpers/ui/showAlert";

interface EditAgentProps {
    handleCreateAgent: () => Promise<void>
    setIsMainPage: Dispatch<SetStateAction<boolean>>
    setActualWorkspace: Dispatch<SetStateAction<string>>
    setWorkspaces: Dispatch<SetStateAction<string[]>>
    workspaces: string[]
}

const EditAgent = ({
    handleCreateAgent,
    setIsMainPage,
    setActualWorkspace,
    setWorkspaces,
    workspaces,
}: EditAgentProps
) => {
    const agentSelectRef = useRef<HTMLSelectElement>(null);
    const [agentName, setAgentName] = useState('');
    const [agentSite, setAgentSite] = useState('');
    const [isBackButtonDisabled, setIsBackButtonDisabled] = useState(true);
    const [isSaveButtonDisabled, setIsSaveButtonDisabled] = useState(true);

    const canSave = isValidJsonKey(agentName) && isValidUrlPatterns(agentSite) && !(agentName !== workspaces[Number(agentSelectRef.current?.value)] && workspaces.includes(agentName));

    const needToSave = () => {
        if (!canSave) {
            setIsSaveButtonDisabled(true);
            return;
        }

        fetchAgentById(agentName).then((agentItem) => {

            if (!agentItem) {
                setIsSaveButtonDisabled(false);
                return;
            }

            if (agentItem.urls !== agentSite) {
                setIsSaveButtonDisabled(false);
                return;
            }

            if (agentName !== workspaces[Number(agentSelectRef.current?.value)]) {
                setIsSaveButtonDisabled(false);
                return;
            }

            setIsSaveButtonDisabled(true);
            return;
        });
    };

    useEffect(() => {
        fetchActualWorkspaceIndex().then((lastSelectIndex) => {
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
        needToSave();

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

        updateOrCreateAgent(localAgentName, newAgentValue).then(() => {
            needToSave();
        });
    };

    const handleLoadAgent = () => {
        if (!agentSelectRef.current) return;

        const workspaceName = getWorkspaceName();
        setActualWorkspace(workspaceName);
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
        setActualWorkspace('');
        removeItem(workspaceName);
    };

    const handleExportAgent = async () => {
        const agent = await fetchAgentById(agentName);
        exportObjectAsJson(agent, agentName);
    }

    const handleGoHome = () => {
        setIsMainPage(true);
    };

    return (
        <main className="content">
            {/* <button onClick={handleGoHome} disabled={isBackButtonDisabled}>Voltar</button> */}
            <button onClick={handleGoHome} className="btn btn-primary">Voltar</button>
            <select ref={agentSelectRef} onChange={handleChangeAgent} className="form-select">
                {workspaces.map((workspace, index) => (
                    <option key={workspace} value={index}>
                        {workspace}
                    </option>
                ))}
            </select>
            <input type="text" className="form-control" placeholder="Nome do agente" value={agentName} onChange={(e) => {
                setAgentName(e.target.value);
            }} aria-invalid={!isValidJsonKey(agentName)} />
            <input type="text" className="form-control" placeholder="Site que o agente irá funcionar" value={agentSite} onChange={(e) => {
                setAgentSite(e.target.value);
            }} aria-invalid={!isValidUrlPatterns(agentSite)} />
            <small>Para criar padrões de URL, basta escrever o domínio e o caminho, usando o caractere <code>*</code> onde quiser aceitar qualquer parte variável. Por exemplo, <code>exemplo.com/*</code> permite combinar tudo que esteja em “exemplo.com” sem se preocupar com o que vem depois da barra. Se quiser abranger subdomínios, faça algo como <code>*.exemplo.com/*</code>, que vale para qualquer coisa antes de “.exemplo.com”. Você pode escrever vários padrões separados por vírgula; por exemplo, <code>exemplo.com/*, outro.com/pasta/*</code> cobre “exemplo.com” e qualquer página na pasta “pasta” de “outro.com”.</small>
            <div className="btn-group" role="group">
                <button onClick={handleCreateAgent} className="btn btn-dark">Criar Novo Agente</button>
                <button onClick={handleSave} className="btn btn-success" disabled={isSaveButtonDisabled}>Salvar</button>
                <button onClick={handleLoadAgent} className="btn btn-primary">Configurar Agente</button>
                <button onClick={handleExportAgent} className="btn btn-secondary">Exportar Agente</button>
                <button onClick={handleDeleteAgent} className="btn btn-danger">Deletar</button>
            </div>
        </main>
    );
};

export default EditAgent;