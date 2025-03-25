/**
 * Verifica se uma tab existe pelo ID.
 * @param tabId O ID da tab a ser verificada.
 * @returns Uma Promise que resolve para true se a tab existe, false caso contrário.
 */
const checkIfTabExists = (tabId: number): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                // A tab não existe mais ou ocorreu um erro
                console.log(`Tab ${tabId} does not exist:`, chrome.runtime.lastError.message);
                resolve(false);
            } else {
                // A tab existe
                console.log(`Tab ${tabId} exists:`, tab);
                resolve(true);
            }
        });
    });

export default checkIfTabExists;