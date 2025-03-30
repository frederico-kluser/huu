import packageJson from '../../package.json';
import TypeAgent from '../types/agent';
import { validateTypeAgent } from './validateTypeAgent';

/**
 * Valida se a versão do JSON importado corresponde à versão do package.json
 * Injeta um input invisível, dispara a seleção de arquivo e o remove após processar
 * @returns {Promise<boolean>} Promise resolvida com true se as versões coincidirem, false caso contrário
 */
const importJsonAgent = (): Promise<TypeAgent> => {
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
                    const importedJson = JSON.parse(jsonContent) as TypeAgent;

                    // Remover o input após processar
                    document.body.removeChild(fileInput);

                    const result = validateTypeAgent(importedJson);

                    if (result.isValid) {
                        if (importedJson.agentVersion !== packageJson.version) {
                            const answer = confirm("A versão do JSON importado não coincide com a versão do package.json. Deseja continuar?");

                            if (!answer) {
                                reject(new Error('Versão do JSON não coincide com a versão do package.json'));
                                return;
                            }
                        }
                    } else {
                        reject(new Error('Erro ao validar o JSON, erro: ' + result.errors[0]));
                        return;
                    }

                    resolve(importedJson);
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

export default importJsonAgent;