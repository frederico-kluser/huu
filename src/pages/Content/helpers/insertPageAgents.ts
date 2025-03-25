import executeCode from "../../../core/executeCode";
import fetchAgentsMatchingUrl from "../../../core/storage/getTabAgents";
import { registerShortcut, ValidKey } from "../../../helpers/registerShortcut";
import TypeHandlerShortcut from "../../../types/shortcuts";

const Window = window as Window & typeof globalThis & { removeShortcuts: TypeHandlerShortcut };
Window['removeShortcuts'] = {};

// TODO: melhorar aparentemente estamos tendo problemas com a execução do código
const InsertPageAgents = () => {
    const removeShortcuts = Window.removeShortcuts;

    Object.keys(removeShortcuts).forEach((key) => {
        removeShortcuts[key].removeListener.forEach((removeListener) => {
            removeListener();
        });
        delete removeShortcuts[key];
    });

    fetchAgentsMatchingUrl(window.location.href).then((agents) => {
        console.log('agents:', agents);

        agents.forEach((agent) => {
            if (!agent.active) return;

            const evalCode = () => {
                executeCode(agent.code);
            };

            removeShortcuts[agent.name] = {
                removeListener: [],
                lastUpdate: Date.now(), // TODO: no futuro vou usar pra otimização
            };

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

    Window.removeShortcuts = removeShortcuts;
};

export default InsertPageAgents;