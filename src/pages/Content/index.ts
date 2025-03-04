import getTabAgents from '../../core/getTabAgents';
import { registerShortcut, ValidKey } from '../../helpers/registerShortcut';

console.log('Content script works!');

const removeShortcuts: {
    [key: string]: {
        removeListener: Array<() => void>;
        lastUpdate: number;
    };
} = {};

const InsertPageAgents = () => {
    Object.keys(removeShortcuts).forEach((key) => {
        removeShortcuts[key].removeListener.forEach((removeListener) => {
            removeListener();
        });
        delete removeShortcuts[key];
    });

    getTabAgents(window.location.href).then((agents) => {
        console.log('agents:', agents);

        agents.forEach((agent) => {
            if (!agent.active) return;

            const evalCode = () => {
                eval(agent.code);
            };

            removeShortcuts[agent.name].removeListener = [];

            switch (agent.mode) {
                case 'manual-shortcut-2':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit2], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit2], evalCode));
                    break;
                case 'manual-shortcut-3':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit3], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit3], evalCode));
                    break;
                case 'manual-shortcut-4':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit4], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit4], evalCode));
                    break;
                case 'manual-shortcut-5':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit5], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit5], evalCode));
                    break;
                case 'manual-shortcut-6':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit6], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit6], evalCode));
                    break;
                case 'manual-shortcut-7':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit7], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit7], evalCode));
                    break;
                case 'manual-shortcut-8':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit8], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit8], evalCode));
                    break;
                case 'manual-shortcut-9':
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit9], evalCode));
                    removeShortcuts[agent.name].removeListener.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit9], evalCode));
                    break;
            }
        });
    });
};

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    console.log('changes:', changes);
    InsertPageAgents();
});

InsertPageAgents();