import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';
import elementSelection from './helpers/elementSelection';

console.log('Content script works!');

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    InsertPageAgents();
    elementSelection(changes);
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);