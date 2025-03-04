export enum ValidKey {
    // Modificadores: versões esquerda e direita
    ControlLeft = 'ControlLeft',
    ControlRight = 'ControlRight',
    AltLeft = 'AltLeft',
    AltRight = 'AltRight',
    ShiftLeft = 'ShiftLeft',
    ShiftRight = 'ShiftRight',
    MetaLeft = 'MetaLeft',
    MetaRight = 'MetaRight',
    // Letras: os códigos começam com "Key"
    KeyA = 'KeyA',
    KeyB = 'KeyB',
    KeyC = 'KeyC',
    KeyD = 'KeyD',
    KeyE = 'KeyE',
    KeyF = 'KeyF',
    KeyG = 'KeyG',
    KeyH = 'KeyH',
    KeyI = 'KeyI',
    KeyJ = 'KeyJ',
    KeyK = 'KeyK',
    KeyL = 'KeyL',
    KeyM = 'KeyM',
    KeyN = 'KeyN',
    KeyO = 'KeyO',
    KeyP = 'KeyP',
    KeyQ = 'KeyQ',
    KeyR = 'KeyR',
    KeyS = 'KeyS',
    KeyT = 'KeyT',
    KeyU = 'KeyU',
    KeyV = 'KeyV',
    KeyW = 'KeyW',
    KeyX = 'KeyX',
    KeyY = 'KeyY',
    KeyZ = 'KeyZ',
    // Dígitos: os códigos começam com "Digit"
    Digit0 = 'Digit0',
    Digit1 = 'Digit1',
    Digit2 = 'Digit2',
    Digit3 = 'Digit3',
    Digit4 = 'Digit4',
    Digit5 = 'Digit5',
    Digit6 = 'Digit6',
    Digit7 = 'Digit7',
    Digit8 = 'Digit8',
    Digit9 = 'Digit9',
}

export const registerShortcut = (shortcut: ValidKey[], callback: () => void) => {
    const pressedKeys = new Set<ValidKey>();
    let callbackExecuted = false;

    const keydownHandler = (event: KeyboardEvent): void => {
        const keyCode = event.code;
        // Se o código da tecla estiver entre os válidos, adiciona ao conjunto
        if ((Object.values(ValidKey) as string[]).includes(keyCode)) {
            pressedKeys.add(keyCode as ValidKey);
        }
        // Executa o callback apenas se:
        // 1. O número de teclas pressionadas for exatamente igual ao número do atalho.
        // 2. Todas as teclas do atalho estiverem pressionadas.
        // 3. O callback ainda não tiver sido executado.
        if (
            !callbackExecuted &&
            pressedKeys.size === shortcut.length &&
            shortcut.every((k) => pressedKeys.has(k))
        ) {
            callback();
            callbackExecuted = true;
        }
    };

    const keyupHandler = (event: KeyboardEvent): void => {
        const keyCode = event.code;
        if ((Object.values(ValidKey) as string[]).includes(keyCode)) {
            pressedKeys.delete(keyCode as ValidKey);
        }
        // Reseta a flag se uma tecla do atalho for liberada.
        if (shortcut.includes(keyCode as ValidKey)) {
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
