export enum ValidKey {
    Control = 'Control',
    Alt = 'Alt',
    Shift = 'Shift',
    Meta = 'Meta',
    A = 'a',
    B = 'b',
    C = 'c',
    D = 'd',
    E = 'e',
    F = 'f',
    G = 'g',
    H = 'h',
    I = 'i',
    J = 'j',
    K = 'k',
    L = 'l',
    M = 'm',
    N = 'n',
    O = 'o',
    P = 'p',
    Q = 'q',
    R = 'r',
    S = 's',
    T = 't',
    U = 'u',
    V = 'v',
    W = 'w',
    X = 'x',
    Y = 'y',
    Z = 'z',
    Digit0 = '0',
    Digit1 = '1',
    Digit2 = '2',
    Digit3 = '3',
    Digit4 = '4',
    Digit5 = '5',
    Digit6 = '6',
    Digit7 = '7',
    Digit8 = '8',
    Digit9 = '9',
}

const normalizeKey = (key: string): string => {
    // Converte para minúscula se for uma única letra ou dígito.
    return key.length === 1 ? key.toLowerCase() : key;
};

export const registerShortcut = (shortcut: ValidKey[], callback: () => void) => {
    const pressedKeys = new Set<ValidKey>();
    let callbackExecuted = false;

    const keydownHandler = (event: KeyboardEvent): void => {
        const normalizedKey = normalizeKey(event.key);
        if ((Object.values(ValidKey) as string[]).includes(normalizedKey)) {
            pressedKeys.add(normalizedKey as ValidKey);
        }
        // Executa o callback apenas uma vez enquanto o atalho estiver pressionado.
        if (shortcut.every((k) => pressedKeys.has(k)) && !callbackExecuted) {
            callback();
            callbackExecuted = true;
        }
    };

    const keyupHandler = (event: KeyboardEvent): void => {
        const normalizedKey = normalizeKey(event.key);
        if ((Object.values(ValidKey) as string[]).includes(normalizedKey)) {
            pressedKeys.delete(normalizedKey as ValidKey);
        }
        // Reseta o flag se uma tecla do atalho for liberada.
        if (shortcut.includes(normalizedKey as ValidKey)) {
            callbackExecuted = false;
        }
    };

    // Listener para restaurar o estado caso o foco seja perdido (ex: mudança de aba ou minimização)
    const blurHandler = (): void => {
        pressedKeys.clear();
        callbackExecuted = false;
    };

    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);
    window.addEventListener('blur', blurHandler);

    // Retorna uma função que remove os listeners adicionados.
    return () => {
        document.removeEventListener('keydown', keydownHandler);
        document.removeEventListener('keyup', keyupHandler);
        window.removeEventListener('blur', blurHandler);
    };
};
