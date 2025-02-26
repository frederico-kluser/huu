import CommunicationChannel from "../types/communicationChannel";

enum DataCommand {
    SEND_CODE = 'sendCode',
};

type TypeMessageData = {
    command: DataCommand;
    sender: CommunicationChannel;
    value: string;
};

type TypeChannelObjectFunction = {
    [key in CommunicationChannel]: (...args: any[]) => void;
};

export const sendMessageConfig: TypeChannelObjectFunction = {
    [CommunicationChannel.BACKGROUND]: (to: CommunicationChannel.CONTENT | CommunicationChannel.POPUP, data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: CommunicationChannel.BACKGROUND, to, data });
    },
    [CommunicationChannel.CONTENT]: (data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: CommunicationChannel.BACKGROUND, data });
    },
    [CommunicationChannel.POPUP]: (data: TypeMessageData) => {
        chrome.runtime.sendMessage({ from: CommunicationChannel.BACKGROUND, data });
    },
};

// TODO: O popup não deve ficar se preocupando em receber as mensagens do background, porque se ele tiver fechado não vai receber (tirar essa duvida depois), o importante é alocar as informações no storage para que o popup possa pegar quando abrir

export const messageListener: TypeChannelObjectFunction = {
    [CommunicationChannel.BACKGROUND]: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === CommunicationChannel.POPUP) {
                // console.log('Background recebeu do popup:', request.data);
                // sendResponse({ data: 'Resposta do background para o popup' });
            } else if (request.from === CommunicationChannel.CONTENT) {
                // console.log('Background recebeu do content script:', request.data);
                // sendResponse({ data: 'Resposta do background para o content script' });
            }
            return true;
        });
    },
    [CommunicationChannel.CONTENT]: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === CommunicationChannel.BACKGROUND) {
                // console.log('Content script recebeu mensagem do background:', request.data);
                // sendResponse({ data: 'Resposta do content script para o background' });
            }
        });
    },
    [CommunicationChannel.POPUP]: () => {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.from === CommunicationChannel.BACKGROUND) {
                // console.log('Popup recebeu mensagem do background:', request.data);
                // sendResponse({ data: 'Resposta do popup para o background' });
            }
        });
    },
};