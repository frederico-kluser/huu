import React from 'react';

interface CreateAgentProps {
    handleCreateAgent: () => void
};

const CreateAgent = ({
    handleCreateAgent,
}: CreateAgentProps) => {

    return (
        <div>
            <h1>Nenhum agente criado</h1>
            <button onClick={handleCreateAgent}>Criar Agente</button>
        </div>
    )
};

export default CreateAgent;