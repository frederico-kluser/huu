/**
 * Exporta um objeto como arquivo JSON para download automático
 * @param {object} data - O objeto a ser exportado como JSON
 * @param {string} [filename='exported-data.json'] - Nome do arquivo a ser baixado
 * @returns {Promise<void>} Promise resolvida quando o download é iniciado
 */
const exportObjectAsJson = <T>(
    data: T,
    filename: string = 'exported-data'
): Promise<void> => {
    return new Promise((resolve, reject): void => {
        try {
            // Converter o objeto para string JSON formatada
            const jsonString = JSON.stringify(data, null, 2);

            // Criar um Blob com o conteúdo JSON
            const blob = new Blob([jsonString], { type: 'application/json' });

            // Criar URL para o Blob
            const url = URL.createObjectURL(blob);

            // Criar elemento de link invisível
            const downloadLink = document.createElement('a');
            downloadLink.href = url;
            downloadLink.download = `${filename}.json`;
            downloadLink.style.display = 'none';
            document.body.appendChild(downloadLink);

            // Configurar limpeza após o download
            const cleanup = (): void => {
                // Remover o link do DOM
                document.body.removeChild(downloadLink);

                // Liberar a URL do objeto
                URL.revokeObjectURL(url);

                resolve();
            };

            // Alguns navegadores precisam do elemento no DOM por um curto período
            // antes de acionar o clique
            setTimeout((): void => {
                // Acionar o download automaticamente
                downloadLink.click();

                // Limpar após um pequeno intervalo para garantir que o download foi iniciado
                setTimeout(cleanup, 100);
            }, 0);
        } catch (error) {
            reject(error instanceof Error ? error : new Error('Erro ao exportar JSON'));
        }
    });
};

export default exportObjectAsJson;