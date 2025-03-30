/**
 * Cria um seletor CSS robusto para um HTMLElement e verifica sua unicidade.
 * Funciona bem em ambientes com styled-components, React, Angular, etc.
 * 
 * @param element O elemento HTML para o qual criar o seletor
 * @returns Uma string contendo o seletor CSS
 * @throws Error se não for possível gerar um seletor único ou se o elemento não for válido
 */
const createUniqueElementSelector = (element: HTMLElement): string => {
  // Validar se o elemento é um HTMLElement válido
  if (!(element instanceof HTMLElement)) {
    throw new TypeError('O argumento deve ser um HTMLElement válido');
  }

  // Função auxiliar para escapar strings em seletores CSS
  const cssEscape = (str: string): string => {
    if (window.CSS) {
      return CSS.escape(str);
    }

    // Implementação simplificada para navegadores que não suportam CSS.escape
    return str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  };

  // Testa se um seletor é válido e identifica UNICAMENTE o elemento original
  const isValidUniqueSelector = (selector: string): boolean => {
    try {
      // Verificar não apenas se o seletor encontra o elemento, mas se é ÚNICO
      const matchingElements = document.querySelectorAll(selector);
      return matchingElements.length === 1 && matchingElements[0] === element;
    } catch (e) {
      return false;
    }
  };

  // Lista de estratégias para criar seletores, em ordem de preferência
  const selectorStrategies = [
    // 1. Estratégia: ID - mais simples e geralmente único
    (): string | null => {
      if (element.id) {
        const selector = `#${cssEscape(element.id)}`;
        return isValidUniqueSelector(selector) ? selector : null;
      }
      return null;
    },

    // 2. Estratégia: Atributos de teste (comuns em projetos React/Angular)
    (): string | null => {
      const testAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-e2e', 'data-qa', 'data-automation-id'];

      for (const attr of testAttrs) {
        const value = element.getAttribute(attr);
        if (value) {
          const selector = `[${attr}="${cssEscape(value)}"]`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }
      }

      return null;
    },

    // 3. Estratégia: Tag com combinação de atributos importantes
    (): string | null => {
      const tag = element.tagName.toLowerCase();

      // Atributos potencialmente únicos (incluindo alguns aria e data)
      const keyAttrs = [
        'name', 'role', 'type', 'value', 'placeholder', 'title', 'alt',
        'aria-label', 'aria-labelledby', 'aria-describedby',
        'data-id', 'data-key', 'data-name', 'data-value', 'data-ref'
      ];

      const attrSelectors: string[] = [];

      // Coletar atributos importantes
      for (const attr of keyAttrs) {
        const value = element.getAttribute(attr);
        if (value) {
          attrSelectors.push(`[${attr}="${cssEscape(value)}"]`);
        }
      }

      // Testar combinações de 1, 2 e 3 atributos com a tag
      if (attrSelectors.length > 0) {
        // Testar atributos individuais
        for (const attrSelector of attrSelectors) {
          const selector = `${tag}${attrSelector}`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }

        // Testar combinações de 2 atributos
        if (attrSelectors.length >= 2) {
          for (let i = 0; i < attrSelectors.length - 1; i++) {
            for (let j = i + 1; j < attrSelectors.length; j++) {
              const selector = `${tag}${attrSelectors[i]}${attrSelectors[j]}`;
              if (isValidUniqueSelector(selector)) {
                return selector;
              }
            }
          }
        }

        // Testar combinação de 3 atributos (se disponíveis)
        if (attrSelectors.length >= 3) {
          for (let i = 0; i < attrSelectors.length - 2; i++) {
            for (let j = i + 1; j < attrSelectors.length - 1; j++) {
              for (let k = j + 1; k < attrSelectors.length; k++) {
                const selector = `${tag}${attrSelectors[i]}${attrSelectors[j]}${attrSelectors[k]}`;
                if (isValidUniqueSelector(selector)) {
                  return selector;
                }
              }
            }
          }
        }
      }

      return null;
    },

    // 4. Estratégia: Tag com classes (melhorado)
    (): string | null => {
      const tag = element.tagName.toLowerCase();

      if (element.classList.length === 0) {
        return null;
      }

      // Classificar classes em dois grupos
      const stableClasses: string[] = [];
      const generatedClasses: string[] = [];

      // Critérios melhorados para identificar classes estáveis vs. geradas
      Array.from(element.classList).forEach((cls) => {
        // Classes mais prováveis de serem estáveis possuem semântica clara
        // Ex: btn, primary, active, card, header, etc.
        if (
          /^[a-zA-Z][a-zA-Z0-9_-]{0,12}$/.test(cls) || // Nomes semânticos curtos
          /^[a-zA-Z]+-[a-zA-Z]+/.test(cls) ||         // Nomes com hífen (component-state)
          /^(btn|button|card|panel|nav|menu|header|footer|sidebar|container|wrapper|row|col|active|disabled|selected|visible|hidden)/.test(cls) // Classes comuns de UI
        ) {
          stableClasses.push(cls);
        } else {
          generatedClasses.push(cls);
        }
      });

      // Testar combinações de classes estáveis
      if (stableClasses.length > 0) {
        // Ordenar por comprimento para favorecer classes mais curtas/semânticas primeiro
        stableClasses.sort((a, b) => a.length - b.length);

        // Tentar com uma classe de cada vez
        for (const cls of stableClasses) {
          const selector = `${tag}.${cssEscape(cls)}`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }

        // Tentar com combinações de duas classes
        if (stableClasses.length >= 2) {
          for (let i = 0; i < stableClasses.length - 1; i++) {
            for (let j = i + 1; j < stableClasses.length; j++) {
              const selector = `${tag}.${cssEscape(stableClasses[i])}.${cssEscape(stableClasses[j])}`;
              if (isValidUniqueSelector(selector)) {
                return selector;
              }
            }
          }
        }

        // Tentar com todas as classes estáveis
        if (stableClasses.length > 2) {
          const selector = `${tag}${stableClasses.map(cls => `.${cssEscape(cls)}`).join('')}`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }
      }

      // Se não funcionou com classes estáveis, tentar com todas as classes
      if (element.classList.length > 0) {
        const allClasses = Array.from(element.classList).map(cls => `.${cssEscape(cls)}`).join('');
        const selector = `${tag}${allClasses}`;
        if (isValidUniqueSelector(selector)) {
          return selector;
        }
      }

      return null;
    },

    // 5. Estratégia: Seleção por texto (para botões, links, labels, etc.)
    (): string | null => {
      // Lista de tags que normalmente têm texto significativo
      const textTags = ['a', 'button', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'th', 'td'];

      const tag = element.tagName.toLowerCase();

      if (textTags.includes(tag)) {
        const text = element.textContent?.trim();

        if (text && text.length > 0 && text.length < 50) {  // Somente textos razoáveis
          // Testar o seletor com contains para texto exato
          const selector = `${tag}:contains("${cssEscape(text)}")`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }

          // Se o texto for longo, tente usar apenas o início
          if (text.length > 10) {
            const startText = text.substring(0, 10);
            const selectorStartsWith = `${tag}:contains("${cssEscape(startText)}")`;
            if (isValidUniqueSelector(selectorStartsWith)) {
              return selectorStartsWith;
            }
          }
        }
      }

      return null;
    },

    // 6. Estratégia: Todos os atributos não ignorados
    (): string | null => {
      const tag = element.tagName.toLowerCase();
      const ignoredAttrs = ['style', 'lang', 'xmlns', 'version', 'encoding'];

      const attrSelectors: string[] = [];

      // Coletar todos os atributos não ignorados
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        const name = attr.name;
        const value = attr.value;

        if (
          !ignoredAttrs.includes(name) &&
          value.length > 0 &&
          value.length < 100  // Ignorar valores muito longos
        ) {
          attrSelectors.push(`[${name}="${cssEscape(value)}"]`);
        }
      }

      // Testar combinações cada vez mais específicas
      if (attrSelectors.length > 0) {
        // Combinar com a tag
        let selector = tag;

        // Adicionar atributos um por um, testando a cada adição
        for (let i = 0; i < attrSelectors.length; i++) {
          selector += attrSelectors[i];
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }
      }

      return null;
    },

    // 7. Estratégia: Caminho DOM com nth-of-type (último recurso)
    (): string | null => {
      const path: string[] = [];
      let currentNode: HTMLElement | null = element;
      let maxDepth = 5; // Limitar a profundidade para evitar seletores muito longos

      while (currentNode && currentNode !== document.body && currentNode !== document.documentElement && maxDepth > 0) {
        const tag = currentNode.tagName.toLowerCase();

        // Se tem ID, podemos usar isso como base e encurtar o seletor
        if (currentNode.id) {
          path.unshift(`#${cssEscape(currentNode.id)}`);
          break;
        }

        // Determinar a posição entre os irmãos do mesmo tipo
        const parent = currentNode.parentElement;

        if (parent) {
          const siblings = Array.from(parent.children)
            .filter((node) => node.nodeName === currentNode?.nodeName);

          if (siblings.length > 1) {
            const index = siblings.indexOf(currentNode) + 1;
            path.unshift(`${tag}:nth-of-type(${index})`);
          } else {
            path.unshift(tag);
          }

          // Tentar adicionar uma classe estável, se disponível
          if (currentNode.classList.length > 0) {
            const stableClass = Array.from(currentNode.classList).find(cls =>
              /^[a-zA-Z][a-zA-Z0-9_-]{0,12}$/.test(cls) ||
              /^[a-zA-Z]+-[a-zA-Z]+/.test(cls)
            );

            if (stableClass) {
              // Substituir o último item do caminho
              path[0] = `${path[0]}.${cssEscape(stableClass)}`;
            }
          }

          // Verificar se o seletor parcial já é único
          if (path.length >= 2) {
            const partialPath = path.join(' > ');
            if (isValidUniqueSelector(partialPath)) {
              return partialPath;
            }
          }
        } else {
          path.unshift(tag);
        }

        currentNode = currentNode.parentElement;
        maxDepth--;
      }

      const fullPath = path.join(' > ');
      return isValidUniqueSelector(fullPath) ? fullPath : null;
    }
  ];

  // Tentar cada estratégia até encontrar um seletor válido
  for (const strategy of selectorStrategies) {
    try {
      const selector = strategy();
      if (selector) {
        return selector;
      }
    } catch (e) {
      // Continuar para a próxima estratégia em caso de erro
      console.error('Erro ao aplicar estratégia de seletor:', e);
    }
  }

  // Se nenhuma estratégia funcionou, lançar um erro
  throw new Error('Não foi possível gerar um seletor único para o elemento fornecido');
};

export default createUniqueElementSelector;