import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import configNavigation from './helpers/configNavigation';
import enums from '../../types/enums';
import { fetchNavigation } from '../../core/storage/navigation';
import handleNavigation from './helpers/handleNavigation';
import { fetchAgentByNavigationBlockId } from '../../core/storage/agents';
import getTabId from './helpers/getTabId';
import checkIfTabExists from './helpers/checkIfTabExists';

console.log('Content script works!');

(window as any).configNavigation = configNavigation;

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    InsertPageAgents();
    elementSelection(changes);
    handleNavigation(changes[enums.SITE_NAVIGATION]?.newValue);
});

fetchNavigation().then(async (data) => {
    console.log('fetchNavigation - data', data);

    if (!data) {
        return;
    }

    const tabExist = await checkIfTabExists(data.tabId);

    if (!tabExist) {
        console.log('checkIfTabExists - tab não existe');
        return;
    }

    const tabId = await getTabId();

    if (data.tabId !== tabId) {
        console.log(`fetchNavigation - diferente tabId: ${tabId} != ${data.tabId}`);
        return;
    }

    const agent = await fetchAgentByNavigationBlockId(data.blockId);

    if (!agent) {
        return;
    }

    console.log('fetchAgentByNavigationBlockId - agent', agent);
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);