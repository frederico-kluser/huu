import executeCode from "../../../core/executeCode";
import fetchAgentsMatchingUrl from "../../../core/storage/getTabAgents";
import { registerShortcut, ValidKey } from "../../../helpers/registerShortcut";
import TypeHandleShortcut from "../../../types/shortcuts";

const Window = window as Window & typeof globalThis & { removeShortcuts: TypeHandleShortcut };
Window['removeShortcuts'] = [];

// TODO: melhorar aparentemente estamos tendo problemas com a execução do código
const InsertPageAgents = () => {
    const removeShortcuts = Window.removeShortcuts;

    removeShortcuts.forEach((removeShortcut) => {
        removeShortcut();
    });

    fetchAgentsMatchingUrl(window.location.href).then((agents) => {
        console.log('agents:', agents);

        agents.forEach((agent) => {
            if (!agent.active) return;

            const evalCode = () => {
                executeCode(agent.code);
            };

            switch (agent.mode) {
                case 'manual-shortcut-2':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit2], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit2], evalCode));
                    break;
                case 'manual-shortcut-3':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit3], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit3], evalCode));
                    break;
                case 'manual-shortcut-4':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit4], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit4], evalCode));
                    break;
                case 'manual-shortcut-5':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit5], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit5], evalCode));
                    break;
                case 'manual-shortcut-6':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit6], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit6], evalCode));
                    break;
                case 'manual-shortcut-7':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit7], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit7], evalCode));
                    break;
                case 'manual-shortcut-8':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit8], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit8], evalCode));
                    break;
                case 'manual-shortcut-9':
                    removeShortcuts.push(registerShortcut([ValidKey.ControlLeft, ValidKey.Digit9], evalCode));
                    removeShortcuts.push(registerShortcut([ValidKey.ControlRight, ValidKey.Digit9], evalCode));
                    break;
            }
        });
    });

    Window.removeShortcuts = removeShortcuts;
};

export default InsertPageAgents;