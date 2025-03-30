import packageJson from '../../package.json';

interface JsonData {
    version: string;
    [key: string]: any;
}

/**
 * Valida se a versão do JSON importado corresponde à versão do package.json
 * Injeta um input invisível, dispara a seleção de arquivo e o remove após processar
 * @returns {Promise<boolean>} Promise resolvida com true se as versões coincidirem, false caso contrário
 */
const validateJsonAgent = (): Promise<boolean> => {
    return new Promise((resolve, reject): void => {
        // Criar input invisível
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        // Handler para processar o arquivo selecionado
        const handleFileSelect = (event: Event): void => {
            const files = (event.target as HTMLInputElement).files;

            if (!files || files.length === 0) {
                document.body.removeChild(fileInput);
                reject(new Error('Nenhum arquivo selecionado'));
                return;
            }

            const file = files[0];
            const reader = new FileReader();

            reader.onload = (loadEvent: ProgressEvent<FileReader>): void => {
                try {
                    const jsonContent = loadEvent.target?.result as string;
                    const importedJson = JSON.parse(jsonContent) as JsonData;

                    // Remover o input após processar
                    document.body.removeChild(fileInput);

                    if (!importedJson.version) {
                        reject(new Error('Propriedade "version" não encontrada no JSON'));
                        return;
                    }

                    const isVersionMatch = importedJson.version === packageJson.version;

                    if (isVersionMatch) {
                        console.log('OK');
                        // Alerta de OK
                        alert('OK');
                    } else {
                        console.log('NOT OK');
                        // Alerta de NOT OK
                        alert('NOT OK');
                    }

                    resolve(isVersionMatch);
                } catch (error) {
                    document.body.removeChild(fileInput);
                    reject(error instanceof Error ? error : new Error('Erro desconhecido ao processar arquivo'));
                }
            };

            reader.onerror = (): void => {
                document.body.removeChild(fileInput);
                reject(new Error('Erro ao ler o arquivo'));
            };

            reader.readAsText(file);
        };

        // Adicionar evento e disparar clique
        fileInput.addEventListener('change', handleFileSelect);
        fileInput.click();
    });
};

export default validateJsonAgent;