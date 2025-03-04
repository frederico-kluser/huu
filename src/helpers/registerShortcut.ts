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

export const registerShortcut = (shortcut: ValidKey[], callback: () => void) => {
    const pressedKeys = new Set<ValidKey>();

    const keydownHandler = (event: KeyboardEvent): void => {
        const key = event.key;
        if ((Object.values(ValidKey) as string[]).includes(key)) {
            pressedKeys.add(key as ValidKey);
        }
        if (shortcut.every((k) => pressedKeys.has(k))) {
            callback();
        }
    };

    const keyupHandler = (event: KeyboardEvent): void => {
        const key = event.key;
        if ((Object.values(ValidKey) as string[]).includes(key)) {
            pressedKeys.delete(key as ValidKey);
        }
    };

    document.addEventListener('keydown', keydownHandler);
    document.addEventListener('keyup', keyupHandler);

    // Retorna uma função que remove os listeners adicionados
    return () => {
        document.removeEventListener('keydown', keydownHandler);
        document.removeEventListener('keyup', keyupHandler);
    };
}
