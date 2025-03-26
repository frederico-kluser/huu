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

// Variável para controlar se o código já foi executado
let codeExecuted = false;

// Função para garantir que o código seja executado apenas uma vez
const safeExecute = (): void => {
    if (!codeExecuted) {
        codeExecuted = true;
        executeContentCode();
    }
};

// Definir um timeout de 5 segundos (5000ms)
const timeoutId = setTimeout(() => {
    safeExecute();
}, 5000);

// Ainda usar o window.onload para casos onde a página carrega rapidamente
window.addEventListener('load', () => {
    // Limpar o timeout se a página carregar antes dos 5 segundos
    clearTimeout(timeoutId);
    safeExecute();
});