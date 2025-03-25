import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import configNavigation from './helpers/configNavigation';
import enums from '../../types/enums';

console.log('Content script works!');

(window as any).configNavigation = configNavigation;

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    InsertPageAgents();
    elementSelection(changes);

    if (changes[enums.SITE_NAVIGATION]?.newValue) {
        console.log('changes[enums.SITE_NAVIGATION]?.newValue', changes[enums.SITE_NAVIGATION]?.newValue);

        const { type, url } = changes[enums.SITE_NAVIGATION].newValue;

        switch (type) {
            case 'forward':
                window.history.forward();
                break;
            case 'back':
                window.history.back();
                break;
            case 'refresh':
                window.location.reload();
                break;
            default:
                if (url) {
                    window.location.href = url;
                } else {
                    console.error('URL não informada');
                }
                break;
        };
    };

    // TODO: criar um verificador de memória do enums.SITE_NAVIGATION para saber se vou ter que executar outros blocos a paritr do ultimo bloco de navegação, o blockId de navegação está disponível no enums.SITE_NAVIGATION
    // TODO: preciso cuidar das variáveis, para não ter problemas durante a navegação, para isso vou ter que ter blocos de set, para as variáveis e nesses blocos preciso salvar as variáveis no chrome.storage.local
});

chrome.storage.local.get([enums.SITE_NAVIGATION], (result) => {
    if (result[enums.SITE_NAVIGATION]) {
        const data = result[enums.SITE_NAVIGATION];

        console.log('SITE_NAVIGATION - data', data);
    }
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);