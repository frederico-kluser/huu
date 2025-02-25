export const configMessage = {
    background: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === 'popup') {
                console.log('Background recebeu do popup:', request.data);
                //   sendResponse({ data: 'Resposta do background para o popup' });
            } else if (request.from === 'content') {
                console.log('Background recebeu do content script:', request.data);
                //   sendResponse({ data: 'Resposta do background para o content script' });
            }
            return true;
        });
    },
    content: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === 'background') {
                console.log('Content script recebeu mensagem do background:', request.data);
                //   sendResponse({ data: 'Resposta do content script para o background' });
            }
        });
    },
    popup: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === 'background') {
                console.log('Popup recebeu mensagem do background:', request.data);
                //   sendResponse({ data: 'Resposta do popup para o background' });
            }
        });
    },
};