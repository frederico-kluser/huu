import React, { Dispatch, SetStateAction, useEffect, useState } from 'react';
import isValidAgent from '../../../../helpers/isValidAgent';

interface MainPageProps {
    setIsMainPage: Dispatch<SetStateAction<boolean>>
    workspaces: string[]
}

const MainPage = ({ setIsMainPage, workspaces }: MainPageProps) => {
    const [approvedAgents, setApprovedAgents] = useState<string[]>([]);

    useEffect(() => {
        const localApprovedAgents: string[] = [];

        workspaces.forEach((workspace) => {
            if (isValidAgent(workspace)) {
                localApprovedAgents.push(workspace);
            }
        });

        setApprovedAgents(localApprovedAgents);
    }, [workspaces]);

    const handleEditModels = () => {
        setIsMainPage(false);
    };

    return (
        <>
            <h1>Hello World</h1>
            {approvedAgents.map((agent) => (
                <p key={agent}>{agent}</p>
            ))}
            <button onClick={handleEditModels}>Editar Modelos</button>
        </>
    )
};

export default MainPage;