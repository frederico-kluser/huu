import React, { useEffect, useState } from 'react';
import TypePageStyle from '../../../../types/pageStyle';
import { getItem, setItem } from '../../../../core/storage';
import enums from '../../../../types/enums';
import validateOpenAIApiKey from '../../../../helpers/validateOpenAiApiKey';
import { showAlert } from '../../../../helpers/ui/showAlert';

interface CreateAgentProps {
    handleCreateAgent: () => void
};

const CreateAgent = ({
    handleCreateAgent,
}: CreateAgentProps) => {
    const [openaiKey, setOpenaiKey] = useState<string>('');
    const [agentInputStatus, setAgentInputStatus] = useState<any>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    
    useEffect(() => {
        // Verificar se já existe uma chave salva
        const checkExistingKey = async () => {
            const savedKey = await getItem<string>(enums.OPENAI_KEY);
            if (savedKey) {
                setOpenaiKey(savedKey);
                // Validar a chave existente
                setIsLoading(true);
                try {
                    const isValid = await validateOpenAIApiKey(savedKey);
                    setAgentInputStatus(isValid ? "false" : "true");
                } catch (error) {
                    setAgentInputStatus("true");
                } finally {
                    setIsLoading(false);
                }
            }
        };
        
        checkExistingKey();
    }, []);

    // validateOpenAIApiKey

    const handleChangeValue = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setOpenaiKey(value)

        if (!value) {
            setAgentInputStatus("");
            return;
        }

        setIsLoading(true);

        try {
            const isValid = await validateOpenAIApiKey(value);
            setAgentInputStatus(isValid ? "false" : "true");
            if (!isValid) {
                showAlert('Chave inválida', 'danger');
            }
        } catch (error) {
            setAgentInputStatus("true");
        } finally {
            setIsLoading(false);
        }
    };

    const handleMiddleware = async () => {
        try {
            await setItem(enums.OPENAI_KEY, openaiKey);
            handleCreateAgent();
        } catch (error) {
            console.error('Erro ao salvar chave API:', error);
            showAlert('Erro ao salvar chave. Tente novamente.', 'danger');
        }
    };

    return (
        <div style={styles.container}>
            <h1>huu</h1>
            {isLoading && <span aria-busy="true">Validando chave da OpenAI...</span>}
            {!isLoading && <>
                <input className="form-control" placeholder='Insira sua chave da OpenAI para criar um agente' type="password" value={openaiKey} onChange={handleChangeValue} aria-invalid={agentInputStatus} style={styles.input} />
                <p>Insira sua chave da OpenAI para criar um agente</p>
                <p>Para obter sua chave, acesse <a href="https://platform.openai.com/account/api-keys" target
                    ="_blank">https://platform.openai.com/account/api-keys</a></p>
                <p>Depois de criar um agente, você pode editá-lo na página de edição de agentes</p>
                <button className="btn btn-primary" onClick={handleMiddleware} disabled={agentInputStatus !== "false"}>Criar Agente</button>
            </>}
        </div>
    )
};

export default CreateAgent;

const styles: TypePageStyle = {
    input: {
        width: '500px',
    },
    container: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
    }
};