interface TabIdResponse {
    tabId?: number;
}

const getTabId = async (): Promise<number | undefined> => {
    try {
        const response: TabIdResponse = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getTabId' }, (result: TabIdResponse) => {
                resolve(result);
            });
        });

        if (response?.tabId) {
            return response.tabId;
            // Agora você pode usar o tabId conforme necessário
        }

        return undefined;
    } catch (error) {
        console.error('Erro ao obter tabId:', error);
        return undefined;
    }
};

export default getTabId;