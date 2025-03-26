import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import configNavigation from './helpers/configNavigation';
import enums from '../../types/enums';
import handleNavigation from './helpers/handleNavigation';
import handleAgentExecution from './helpers/handleAgentExecution';

console.log('Content script works!');

(window as any).configNavigation = configNavigation;

window.onload = () => {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        InsertPageAgents();
        elementSelection(changes);
        handleNavigation(changes[enums.SITE_NAVIGATION]?.newValue);
    });


    handleAgentExecution();
    InsertPageAgents();

    registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
    registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);
};