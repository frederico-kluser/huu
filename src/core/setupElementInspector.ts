const setupElementInspector = (): Promise<HTMLElement | null> => new Promise((resolve) => {
    // Variável para controlar se o seletor está ativo
    let isActive: boolean = false;

    // Elemento que está atualmente destacado
    let currentHighlightedElement: HTMLElement | null = null;

    // Elemento overlay para o destaque
    let highlightOverlay: HTMLElement | null = null;

    // Elemento para exibir informações sobre o elemento atual
    let infoBox: HTMLDivElement | null = null;

    // ID único para nossos elementos injetados
    const uniqueId = `element-inspector-${Date.now()}`;

    // Função para injetar os estilos CSS necessários
    const injectStyles = (): void => {
        const styleEl = document.createElement('style');
        styleEl.id = `${uniqueId}-styles`;
        styleEl.textContent = `
            #${uniqueId}-overlay {
                position: absolute;
                box-shadow: 0 0 0 2px #4285f4;
                background-color: rgba(66, 133, 244, 0.1);
                pointer-events: none;
                z-index: 2147483646;
                transition: all 0.1s ease;
            }
            #${uniqueId}-info {
                position: fixed;
                left: 0;
                bottom: 0;
                background-color: #333;
                color: white;
                font-family: monospace;
                padding: 5px 10px;
                border-top-right-radius: 3px;
                z-index: 2147483647;
                font-size: 12px;
                pointer-events: none;
                max-width: 100%;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
        `;
        document.head.appendChild(styleEl);
    };

    // Função para criar o overlay de destaque
    const createHighlightOverlay = (): void => {
        highlightOverlay = document.createElement('div');
        highlightOverlay.id = `${uniqueId}-overlay`;
        highlightOverlay.style.display = 'none';
        document.body.appendChild(highlightOverlay);
    };

    // Criar a caixa de informações
    const createInfoBox = (): void => {
        infoBox = document.createElement('div');
        infoBox.id = `${uniqueId}-info`;
        document.body.appendChild(infoBox);
    };

    // Gera um seletor CSS para o elemento
    const generateSelector = (element: HTMLElement): string => {
        if (element.id) {
            return `#${element.id}`;
        }

        if (element.className) {
            const classes = Array.from(element.classList).join('.');
            return `${element.tagName.toLowerCase()}.${classes}`;
        }

        // Fallback para seletor de caminho
        const path: string[] = [];
        let current: HTMLElement | null = element;

        while (current && current !== document.body && current !== document.documentElement) {
            let selector: string = current.tagName.toLowerCase();

            if (current.id) {
                selector = `#${current.id}`;
                path.unshift(selector);
                break;
            } else if (current.className) {
                selector = `${selector}.${Array.from(current.classList).join('.')}`;
            }

            // Adiciona o índice do elemento entre seus irmãos do mesmo tipo
            const parentNode = current.parentNode as HTMLElement;
            const siblings = Array.from(parentNode.children).filter(
                (sibling) => sibling.tagName === current?.tagName,
            );

            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
            }

            path.unshift(selector);
            current = current.parentNode as HTMLElement;

            // Limite o tamanho do seletor
            if (path.length > 5) {
                break;
            }
        }

        return path.join(' > ');
    };

    // Atualiza as informações na caixa
    const updateInfoBox = (element: HTMLElement): void => {
        if (!infoBox) return;

        const tagName = element.tagName.toLowerCase();
        const id = element.id ? `#${element.id}` : '';
        const classes = Array.from(element.classList).map(c => `.${c}`).join('');
        const dimensions = `${element.offsetWidth}×${element.offsetHeight}`;
        const selector = generateSelector(element);

        infoBox.innerHTML = `
            <div>${tagName}${id}${classes} ${dimensions}px</div>
            <div style="opacity: 0.8; font-size: 10px;">${selector}</div>
        `;
    };

    // Posiciona o overlay em cima do elemento
    const positionOverlay = (element: HTMLElement): void => {
        if (!highlightOverlay) return;

        const rect = element.getBoundingClientRect();

        highlightOverlay.style.display = 'block';
        highlightOverlay.style.top = `${window.scrollY + rect.top}px`;
        highlightOverlay.style.left = `${window.scrollX + rect.left}px`;
        highlightOverlay.style.width = `${rect.width}px`;
        highlightOverlay.style.height = `${rect.height}px`;
    };

    // Função para destacar um elemento 
    const highlightElement = (element: HTMLElement): void => {
        // Atualiza o elemento atualmente destacado
        currentHighlightedElement = element;

        // Posiciona o overlay
        positionOverlay(element);

        // Atualiza a caixa de informações
        updateInfoBox(element);
    };

    // Função para remover o destaque
    const removeHighlight = (): void => {
        currentHighlightedElement = null;

        if (highlightOverlay) {
            highlightOverlay.style.display = 'none';
        }

        if (infoBox) {
            infoBox.textContent = '';
        }
    };

    // Copia o seletor CSS para a área de transferência
    const copySelectorToClipboard = (element: HTMLElement): void => {
        const selector = generateSelector(element);

        navigator.clipboard.writeText(selector)
            .then(() => {
                console.log(`%cSeletor copiado: ${selector}`, 'color: #4285f4');

                // Feedback visual temporário
                if (infoBox) {
                    const originalTextContent = infoBox.innerHTML;
                    infoBox.innerHTML = '<div style="color: #8efa00">✓ Seletor copiado para a área de transferência</div>';

                    setTimeout(() => {
                        if (infoBox && currentHighlightedElement) {
                            updateInfoBox(currentHighlightedElement);
                        }
                    }, 1000);
                }
            })
            .catch((err: Error) => {
                console.error('Erro ao copiar: ', err);
            });
    };

    // Manipulador de evento para mouseover
    const handleMouseOver = (event: Event): void => {
        if (!isActive) return;

        const mouseEvent = event as MouseEvent;
        mouseEvent.stopPropagation();

        const target = mouseEvent.target as HTMLElement;

        // Não destacamos nossos próprios elementos
        if (target.id === `${uniqueId}-overlay` || target.id === `${uniqueId}-info`) {
            return;
        }

        // Destaca o elemento
        highlightElement(target);
    };

    // Manipulador de evento para click
    const handleClick = (event: Event): void => {
        if (!isActive) return;

        const mouseEvent = event as MouseEvent;
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        // Salva o elemento clicado
        const clickedElement = mouseEvent.target as HTMLElement;

        // Não processamos cliques em nossos próprios elementos
        if (clickedElement.id === `${uniqueId}-overlay` || clickedElement.id === `${uniqueId}-info`) {
            return;
        }

        // Faz o console.log do elemento
        console.log('%cElemento selecionado:', 'color: #4285f4; font-weight: bold', clickedElement);

        // Desativa o seletor (isso chamará cleanupUI)
        toggleSelector(false);

        // Resolve após desativar o seletor
        resolve(clickedElement);
    };

    // Manipulador de evento para teclas (Esc para sair)
    const handleKeyDown = (event: Event): void => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === 'Escape' && isActive) {
            toggleSelector(false);
            resolve(null);
        }
    };

    // Função para limpar a UI
    const cleanupUI = (): void => {
        removeHighlight();

        // Remove os elementos da UI
        if (highlightOverlay) {
            highlightOverlay.remove();
            highlightOverlay = null;
        }

        if (infoBox) {
            infoBox.remove();
            infoBox = null;
        }

        // Remove os estilos injetados
        const styleEl = document.getElementById(`${uniqueId}-styles`);
        if (styleEl) {
            styleEl.remove();
        }
    };

    // Ativa ou desativa o seletor
    const toggleSelector = (state?: boolean): string => {
        isActive = state !== undefined ? state : !isActive;

        if (isActive) {
            console.log('%c✓ Seletor de elementos ativado', 'color: #4285f4; font-weight: bold');
            console.log('Passe o mouse sobre os elementos para destacá-los');
            console.log('Clique em um elemento para selecionar e parar o seletor');
            console.log('Pressione ESC para desativar o seletor');

            // Injeta os estilos
            injectStyles();

            // Cria os elementos de UI
            createHighlightOverlay();
            createInfoBox();

            // Adiciona os event listeners
            document.addEventListener('mouseover', handleMouseOver, true);
            document.addEventListener('click', handleClick, true);
            document.addEventListener('keydown', handleKeyDown);
        } else {
            console.log('%c✗ Seletor de elementos desativado', 'color: #ea4335; font-weight: bold');

            // Remove os event listeners
            document.removeEventListener('mouseover', handleMouseOver, true);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('keydown', handleKeyDown);

            // Limpa a UI
            cleanupUI();
        }

        return isActive ? 'Seletor ativado' : 'Seletor desativado';
    };

    // Função para limpar completamente o seletor da página
    const cleanupSelector = (): string => {
        // Garantir que o seletor esteja desativado
        if (isActive) {
            toggleSelector(false);
        }

        // Remover a função global
        (window as any).toggleElementSelector = undefined;
        (window as any).cleanupElementSelector = undefined;

        console.log('%c✓ Seletor de elementos removido', 'color: #4285f4; font-weight: bold');

        return 'Seletor removido com sucesso';
    };

    // Ativa o seletor automaticamente ao executar o script
    toggleSelector(true);

    // Expõe as funções no escopo global
    (window as any).toggleElementSelector = toggleSelector;
    (window as any).cleanupElementSelector = cleanupSelector;

    console.log('Use window.toggleElementSelector() para ativar/desativar o seletor');
    console.log('Use window.cleanupElementSelector() para remover o seletor completamente');
});

export default setupElementInspector;