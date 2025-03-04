import getTabAgents from '../../core/getTabAgents';
import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';

console.log('Content script works!');

const removeShortcuts: {
    [key: string]: {
        removeListener: () => void;
        lastUpdate: number;
    };
} = {};

getTabAgents(window.location.href).then((agents) => {
    console.log('agents:', agents);

    agents.forEach((agent) => {
        if (!agent.active) return;

        const evalCode = () => {
            eval(agent.code);
        };

        switch (agent.mode) {
            case 'manual-shortcut-2':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit2], evalCode);
                break;
            case 'manual-shortcut-3':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit3], evalCode);
                break;
            case 'manual-shortcut-4':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit4], evalCode);
                break;
            case 'manual-shortcut-5':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit5], evalCode);
                break;
            case 'manual-shortcut-6':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit6], evalCode);
                break;
            case 'manual-shortcut-7':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit7], evalCode);
                break;
            case 'manual-shortcut-8':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit8], evalCode);
                break;
            case 'manual-shortcut-9':
                removeShortcuts[agent.name].removeListener = registerShortcut([ValidKey.Control, ValidKey.Digit9], evalCode);
                break;
        }
    });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    console.log('changes:', changes);
});