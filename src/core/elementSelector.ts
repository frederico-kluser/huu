const elementSelector = () => {
    // Interface para estender o HTMLElement com propriedades personalizadas
    interface ExtendedHTMLElement extends HTMLElement {
        _originalOutline: string;
        _originalOutlineOffset: string;
        _originalBgColor: string;
    }

    // Variável para controlar se o seletor está ativo
    let isActive: boolean = false;

    // Elemento que está atualmente destacado
    let currentHighlightedElement: ExtendedHTMLElement | null = null;

    // Elemento para exibir informações sobre o elemento atual
    let infoBox: HTMLDivElement | null = null;

    // Criar a caixa de informações
    const createInfoBox = (): void => {
        infoBox = document.createElement('div');
        infoBox.id = 'element-selector-info';
        infoBox.style.cssText = `
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
    `;
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

    // Função para destacar um elemento
    const highlightElement = (element: HTMLElement): void => {
        const extendedElement = element as ExtendedHTMLElement;

        if (currentHighlightedElement) {
            // Remove o destaque do elemento anterior
            currentHighlightedElement.style.outline = currentHighlightedElement._originalOutline;
            currentHighlightedElement.style.outlineOffset = currentHighlightedElement._originalOutlineOffset;
            currentHighlightedElement.style.backgroundColor = currentHighlightedElement._originalBgColor;
        }

        // Salva os estilos originais específicos
        extendedElement._originalOutline = extendedElement.style.outline;
        extendedElement._originalOutlineOffset = extendedElement.style.outlineOffset;
        extendedElement._originalBgColor = extendedElement.style.backgroundColor;

        // Aplica o estilo de destaque
        extendedElement.style.outline = '2px solid #4285f4';
        extendedElement.style.outlineOffset = '-1px';
        extendedElement.style.backgroundColor = 'rgba(66, 133, 244, 0.1)';

        // Atualiza o elemento atualmente destacado
        currentHighlightedElement = extendedElement;

        // Atualiza a caixa de informações
        updateInfoBox(element);
    };

    // Função para remover o destaque de todos os elementos
    const removeAllHighlights = (): void => {
        if (currentHighlightedElement) {
            currentHighlightedElement.style.outline = currentHighlightedElement._originalOutline;
            currentHighlightedElement.style.outlineOffset = currentHighlightedElement._originalOutlineOffset;
            currentHighlightedElement.style.backgroundColor = currentHighlightedElement._originalBgColor;
            currentHighlightedElement = null;
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
                        if (infoBox) {
                            infoBox.innerHTML = originalTextContent;
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
        // Impede a propagação para elementos pais
        mouseEvent.stopPropagation();

        // Destaca o elemento
        highlightElement(mouseEvent.target as HTMLElement);
    };

    // Manipulador de evento para mouseout
    const handleMouseOut = (event: Event): void => {
        if (!isActive) return;

        // Remove destaque ao sair da página
        if (event.target === document.documentElement) {
            removeAllHighlights();
        }
    };

    // Manipulador de evento para click
    const handleClick = (event: Event): void => {
        if (!isActive) return;

        const mouseEvent = event as MouseEvent;
        // Impede o comportamento padrão do clique para não navegar ou acionar scripts
        mouseEvent.preventDefault();
        mouseEvent.stopPropagation();

        // Salva o elemento clicado
        const clickedElement = mouseEvent.target as HTMLElement;

        // Faz o console.log do elemento
        console.log('%cElemento selecionado:', 'color: #4285f4; font-weight: bold', clickedElement);

        // Desativa o seletor para restaurar o comportamento normal do site
        toggleSelector();
    };

    // Manipulador de evento para teclas (Esc para sair)
    const handleKeyDown = (event: Event): void => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === 'Escape' && isActive) {
            toggleSelector();
        }
    };

    // Ativa ou desativa o seletor
    const toggleSelector = (): string => {
        isActive = !isActive;

        if (isActive) {
            console.log('%c✓ Seletor de elementos ativado', 'color: #4285f4; font-weight: bold');
            console.log('Passe o mouse sobre os elementos para destacá-los');
            console.log('Clique em um elemento para selecionar e parar o seletor');
            console.log('Pressione ESC para desativar o seletor');

            if (!infoBox) {
                createInfoBox();
            }

            document.addEventListener('mouseover', handleMouseOver, true);
            document.addEventListener('mouseout', handleMouseOut, true);
            document.addEventListener('click', handleClick, true);
            document.addEventListener('keydown', handleKeyDown);
        } else {
            console.log('%c✗ Seletor de elementos desativado', 'color: #ea4335; font-weight: bold');

            document.removeEventListener('mouseover', handleMouseOver, true);
            document.removeEventListener('mouseout', handleMouseOut, true);
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('keydown', handleKeyDown);

            removeAllHighlights();

            if (infoBox) {
                infoBox.remove();
                infoBox = null;
            }
        }

        return isActive ? 'Seletor ativado' : 'Seletor desativado';
    };

    // Função para limpar completamente o seletor da página
    const cleanupSelector = (): string => {
        // Garantir que o seletor esteja desativado
        if (isActive) {
            toggleSelector();
        }

        // Remover a função global
        (window as any).toggleElementSelector = undefined;
        (window as any).cleanupElementSelector = undefined;

        console.log('%c✓ Seletor de elementos removido', 'color: #4285f4; font-weight: bold');

        return 'Seletor removido com sucesso';
    };

    // Ativa o seletor automaticamente ao executar o script
    toggleSelector();

    // Expõe as funções no escopo global
    (window as any).toggleElementSelector = toggleSelector;
    (window as any).cleanupElementSelector = cleanupSelector;

    console.log('Use window.toggleElementSelector() para ativar/desativar o seletor');
    console.log('Use window.cleanupElementSelector() para remover o seletor completamente');
};

export default elementSelector;