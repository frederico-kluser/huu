import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';
import setupElementInspector from '../../core/setupElementInspector';
import InsertPageAgents from './helpers/insertPageAgents';

console.log('Content script works!');

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    console.log('changes:', changes);
    InsertPageAgents();
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);