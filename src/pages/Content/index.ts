import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import configNavigation from './helpers/configNavigation';
import enums from '../../types/enums';
import { fetchNavigation } from '../../core/storage/navigation';
import handleNavigation from './helpers/handleNavigation';

console.log('Content script works!');

(window as any).configNavigation = configNavigation;

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    InsertPageAgents();
    elementSelection(changes);
    handleNavigation(changes[enums.SITE_NAVIGATION]?.newValue);

    // TODO: criar um verificador de memória do enums.SITE_NAVIGATION para saber se vou ter que executar outros blocos a paritr do ultimo bloco de navegação, o blockId de navegação está disponível no enums.SITE_NAVIGATION
    // TODO: preciso cuidar das variáveis, para não ter problemas durante a navegação, para isso vou ter que ter blocos de set, para as variáveis e nesses blocos preciso salvar as variáveis no chrome.storage.local
});

fetchNavigation().then((data) => {
    console.log('fetchNavigation - data', data);
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);