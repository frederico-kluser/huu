import React, { Dispatch, SetStateAction, useRef, useState } from 'react';
import { getItem, removeItem } from '../../../../core/storage';
import keys from '../../../../types/keys';
import isValidUrl from '../../../../helpers/isValidUrl';
import isValidJsonKey from '../../../../helpers/isValidJsonKey';

interface EditAgentProps {
    setWorkspaceName: Dispatch<SetStateAction<string>>
    handleCreateAgent: () => void
    workspaces: string[]
    setWorkspaces: Dispatch<SetStateAction<string[]>>
}

const EditAgent = ({
    setWorkspaceName,
    handleCreateAgent,
    workspaces,
    setWorkspaces,
}: EditAgentProps
) => {
    const selectRef = useRef<HTMLSelectElement>(null);
    const [agentName, setAgentName] = useState(workspaces[0] as string || '');
    const [agentSite, setAgentSite] = useState('');

    const handleSave = () => {
        setWorkspaceName('');
    };

    const handleLoadAgent = () => {
        if (!selectRef.current) return;

        const workspaceName = selectRef.current.value;
        setWorkspaceName(workspaceName);
    };

    const handleChangeAgent = () => {
        if (!selectRef.current) return;
        setAgentName(selectRef.current.value);
    };

    const handleDeleteAgent = () => {
        if (!selectRef.current) return;

        const workspaceName = selectRef.current.value;
        if (!confirm(`Deseja realmente deletar o agente "${workspaceName}"?`)) return;

        setWorkspaces(workspaces.filter((workspace) => workspace !== workspaceName));
        setWorkspaceName('');
        removeItem(workspaceName);
    };

    const handleBack = () => { };

    const canSave = isValidJsonKey(agentName) && isValidUrl(agentSite);

    return (
        <main className="content">
            <button onClick={handleBack}>Voltar</button>
            <select ref={selectRef} onChange={handleChangeAgent}>
                {workspaces.map((workspace) => (
                    <option key={workspace} value={workspace}>
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
                <button onClick={handleSave} disabled={!canSave}>Salvar</button>
                <button onClick={handleLoadAgent}>Editar</button>
                <button onClick={handleDeleteAgent}>Deletar</button>
            </div>
        </main>
    );
};

export default EditAgent;