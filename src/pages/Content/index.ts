import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import enums from '../../types/enums';
import handleNavigation from './helpers/handleNavigation';
import handleAgentExecution from './helpers/handleAgentExecution';
import injectFeatures from './injectFeatures';

console.log('Content script works!');

Object.entries(injectFeatures).forEach(([key, value]) => {
    (window as any)[key] = value;
});

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