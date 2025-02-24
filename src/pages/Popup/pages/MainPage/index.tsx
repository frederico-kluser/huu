import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import isValidAgent from '../../../../helpers/isValidAgent';
import { fetchAgentById, updateAgentPartial } from '../../../../core/storageAgents';
import { TypeMode } from '../../../../types/agent';

interface MainPageProps {
    setIsMainPage: Dispatch<SetStateAction<boolean>>
    workspaces: string[]
}

const MainPage = ({ setIsMainPage, workspaces }: MainPageProps) => {
    const [approvedAgents, setApprovedAgents] = useState<string[]>([]);

    const updateApprovedAgents = () => {
        const localApprovedAgents: string[] = [];

        workspaces.forEach((workspace) => {
            if (isValidAgent(workspace)) {
                localApprovedAgents.push(workspace);
            }
        });

        setApprovedAgents(localApprovedAgents);
    }

    useEffect(updateApprovedAgents, [workspaces]);

    const handleEditMode = (agentName: string, mode: TypeMode) => {
        updateAgentPartial(agentName, {
            mode,
        });

        updateApprovedAgents();
    };

    const handleEditModels = () => {
        setIsMainPage(false);
    };

    return (
        <>
            <h1>huu</h1>
            {approvedAgents.length === 0 && <h4>Nenhum agente criado</h4>}
            {approvedAgents.length > 0 && <h4>Agentes para este site <mark><i>youtube.com/</i></mark></h4>}
            {approvedAgents.map((agent) => (
                <div role="group" key={agent}>
                    <h3 style={{
                        width: '50%',
                        lineHeight: '56px',
                    }}>{agent}</h3>
                    <select onChange={(e) => handleEditMode(agent, e.target.value as TypeMode)} value={fetchAgentById(agent)?.mode}>
                        <option value="">Selecione o modo de acionamento</option>
                        <option value="automatic-1">Acionar automaticamente uma vez</option>
                        <option value="automatic">Acionar automaticamente sem parar</option>
                        <option value="manual-shortcut-2">Manual pelo atalho Ctrl + Shift + 2</option>
                        <option value="manual-shortcut-3">Manual pelo atalho Ctrl + Shift + 3</option>
                        <option value="manual-shortcut-4">Manual pelo atalho Ctrl + Shift + 4</option>
                        <option value="manual-shortcut-5">Manual pelo atalho Ctrl + Shift + 5</option>
                        <option value="manual-shortcut-6">Manual pelo atalho Ctrl + Shift + 6</option>
                        <option value="manual-shortcut-7">Manual pelo atalho Ctrl + Shift + 7</option>
                        <option value="manual-shortcut-8">Manual pelo atalho Ctrl + Shift + 8</option>
                        <option value="manual-shortcut-9">Manual pelo atalho Ctrl + Shift + 9</option>
                    </select>
                </div>
            ))}
            <button onClick={handleEditModels}>Editar Agentes</button>
        </>
    )
};

export default MainPage;