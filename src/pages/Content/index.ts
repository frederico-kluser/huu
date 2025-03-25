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
});

InsertPageAgents();

registerShortcut([ValidKey.ControlLeft, ValidKey.Digit1], setupElementInspector);
registerShortcut([ValidKey.ControlRight, ValidKey.Digit1], setupElementInspector);