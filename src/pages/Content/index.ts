import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';
import configNavigation from './helpers/configNavigation';

console.log('Content script works!');

(window as any).configNavigation = configNavigation;

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    InsertPageAgents();
    elementSelection(changes);
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);