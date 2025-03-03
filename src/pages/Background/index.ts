import { messageListener } from "../../core/message";

console.log('This is the background page.');
console.log('Put the background scripts here.');

// quando a aba ativa muda
chrome.tabs.onActivated.addListener((activeInfo) => {
    console.log("Aba ativa mudou:", activeInfo);
    /*
    {
        "tabId": 1656147163,
        "windowId": 1656147162
    }
    */
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        console.log("Nova aba ativa:", tab);
    });
    /*
    {
        "active": true,
        "audible": false,
        "autoDiscardable": true,
        "discarded": false,
        "favIconUrl": "",
        "frozen": false,
        "groupId": -1,
        "height": 1279,
        "highlighted": true,
        "id": 1656147163,
        "incognito": false,
        "index": 0,
        "lastAccessed": 1741011694646.114,
        "mutedInfo": {
            "muted": false
        },
        "pinned": false,
        "selected": true,
        "status": "complete",
        "title": "Extensions",
        "url": "chrome://extensions/",
        "width": 1708,
        "windowId": 1656147162
    }
    */
});

// quando a janela ativa muda
// chrome.windows.onFocusChanged.addListener((windowId) => {
//     if (windowId === chrome.windows.WINDOW_ID_NONE) {
//         console.log("Nenhuma janela ativa (usuário minimizou ou trocou de aplicação)");
//     } else {
//         console.log("Janela ativa mudou:", windowId);
//     }
// });

// quando a aba é atualizada (mesmo um link passa por varios processos de atualização)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete") return // no futuro vou permitir injeção de código em outras situações
    console.log("Aba atualizou:", {
        tabId,
        changeInfo,
        tab
    });
});
/*
{
    "tabId": 1656147207,
    "changeInfo": {
        "status": "complete"
    },
    "tab": {
        "active": true,
        "audible": false,
        "autoDiscardable": true,
        "discarded": false,
        "favIconUrl": "https://www.youtube.com/s/desktop/f72bfc7f/img/logos/favicon_32x32.png",
        "frozen": false,
        "groupId": -1,
        "height": 1279,
        "highlighted": true,
        "id": 1656147207,
        "incognito": false,
        "index": 1,
        "lastAccessed": 1741011462051.818,
        "mutedInfo": {
            "muted": false
        },
        "openerTabId": 1656147163,
        "pinned": false,
        "selected": true,
        "status": "complete",
        "title": "YouTube",
        "url": "https://www.youtube.com/",
        "width": 1708,
        "windowId": 1656147162
    }
}
*/

messageListener.background();

/*
chrome.tabs.onActivated.addListener((activeInfo) => {

Projeto, criação de robots para automatizar tarefas repetitivas em sites, usando IA para criar condicionais abstratas, e llms para geração de textos com base em contexto.

- O background identifica quando a aba ativa muda e procura a variável no object window com o tabId concatenado no nome huu ex: window['huu1656146879']:
    - Caso tenha a variável, o código já foi injetado, é então verificado a data de atualização
        - Se o código tiver sido atualizado é injetado novamente no content script e atualizado a data de atualização
        - Se o código não tiver sido atualizado, nada é feito

    - Caso não tenha a variável, o código é injetado no content script, e a variável é criada, com o seguinte valor:

// variavel simplificada para window object
{
    "uuid": string, // identificador único do código
    "updatedAt": number, // data da última atualização do código
}[] // array pode ser usado para armazenar mais de um código por aba

// variavel completa para chrome storage
{
    urls: "youtube.com/*,facebook.com/*",
    agentName: "Robot auto like",
    tabId: 1656146879,
    code: "document.querySelectorAll('button.like').forEach((button) => button.click());",
    shortcut: "Ctrl+Shift+L",
    status: "active",
    uuid: "1234567890",
    updatedAt: 1740799621975,
}

- O valor salvo no chrome storage deve acionar um listener no background, para que esse saiba quando atualizar a variável no window object

// importante de quando houver reload na página, o código ser injetado novamente, e a data de atualização ser atualizada no window object

// importante de quando houver troca de página, não fazer nada porque o código não é mais necessário e não vai constar no window object
*/
