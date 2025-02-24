import React, { Dispatch, SetStateAction } from 'react';

interface CreateAgentProps {
    setWorkspaceName: Dispatch<SetStateAction<string>>
    setWorkspaces: Dispatch<SetStateAction<string[]>>
    workspaces: string[]
};

const CreateAgent = ({
    setWorkspaceName,
    setWorkspaces,
    workspaces,
}: CreateAgentProps) => {

    const handleCreateAgent = () => {
        const workspaceName = prompt('Digite o nome do agente', 'Agente 1');
        if (!workspaceName) return;
        // TODO: validar se já existe um agente com esse nome
        // TODO: validar se o nome é válido
        setWorkspaces([...workspaces, workspaceName]);
        setWorkspaceName(workspaceName);
    };

    return (
        <div>
            <h1>Nenhum agente criado</h1>
            <button onClick={handleCreateAgent}>Criar Agente</button>
        </div>
    )
};

export default CreateAgent;