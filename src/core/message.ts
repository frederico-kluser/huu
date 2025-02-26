import MessageType from "../types/messageType";

enum DataCommand {
    SEND_CODE = 'sendCode',
};

type TypeMessageData = {
    command: DataCommand;
    value: string;
};

export const messageListener = {
    background: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === MessageType.POPUP) {
                // console.log('Background recebeu do popup:', request.data);
                //   sendResponse({ data: 'Resposta do background para o popup' });
            } else if (request.from === MessageType.CONTENT) {
                // console.log('Background recebeu do content script:', request.data);
                //   sendResponse({ data: 'Resposta do background para o content script' });
            }
            return true;
        });
    },
    content: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === MessageType.BACKGROUND) {
                // console.log('Content script recebeu mensagem do background:', request.data);
                //   sendResponse({ data: 'Resposta do content script para o background' });
            }
        });
    },
    popup: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === MessageType.BACKGROUND) {
                // console.log('Popup recebeu mensagem do background:', request.data);
                //   sendResponse({ data: 'Resposta do popup para o background' });
            }
        });
    },
};

export const sendMessageConfig = {
    background: (to: MessageType, data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: MessageType.BACKGROUND, to, data });
    },
    content: (data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: MessageType.BACKGROUND, data });
    },
    popup: (data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: MessageType.BACKGROUND, data });
    },
};