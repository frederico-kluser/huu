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

// Função que contém o código que estava no window.onload
const executeContentCode = (): void => {
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

let isTimeoutExecuted = false;

const timeout = setTimeout(() => {
    isTimeoutExecuted = true;
    console.log('executeContentCode - timeout executed');
    executeContentCode();
}, 5000);

// Ainda usar o window.onload para casos onde a página carrega rapidamente
window.addEventListener('load', () => {
    if (isTimeoutExecuted) {
        return;
    }
    console.log('executeContentCode - timeout cancelled');
    clearTimeout(timeout);
    setTimeout(() => {
        executeContentCode();
        console.log('executeContentCode - window.onload - setTimeout');
    }, 1000);
});