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
    // if (window.CSS && window.CSS.escape) {
    if (window.CSS) {
      return CSS.escape(str);
    }

    // Implementação simplificada para navegadores que não suportam CSS.escape
    return str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
  };

  // Testa se um seletor é válido e identifica unicamente o elemento original
  const isValidUniqueSelector = (selector: string): boolean => {
    try {
      const result = document.querySelector(selector);
      return result === element;
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
      const testAttrs = ['data-testid', 'data-test-id', 'data-cy', 'data-e2e', 'data-qa'];

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

    // 3. Estratégia: Tag com classes (filtradas para evitar classes geradas)
    (): string | null => {
      const tag = element.tagName.toLowerCase();
      // Filtrar classes que parecem ser geradas automaticamente
      const classes = Array.from(element.classList)
        .filter((cls) => {
          // Ignorar classes que parecem ser geradas por frameworks
          const isLikelyGenerated = /^[a-z0-9_-]{5,}$/i.test(cls) &&
            !/^[a-zA-Z]+-[a-zA-Z]+/.test(cls);
          return !isLikelyGenerated;
        })
        .map((cls) => `.${cssEscape(cls)}`)
        .join('');

      if (classes) {
        const selector = `${tag}${classes}`;
        return isValidUniqueSelector(selector) ? selector : null;
      }

      return null;
    },

    // 4. Estratégia: Atributos específicos (exceto comuns/padrão)
    (): string | null => {
      const tag = element.tagName.toLowerCase();
      const ignoredAttrs = ['id', 'class', 'style', 'src', 'href', 'type', 'name'];

      for (let i = 0; i < element.attributes.length; i += 1) {
        const attr = element.attributes[i];
        const name = attr.name;

        if (!ignoredAttrs.includes(name) &&
          !name.startsWith('data-') &&
          !name.startsWith('aria-') &&
          attr.value) {
          const selector = `${tag}[${name}="${cssEscape(attr.value)}"]`;
          if (isValidUniqueSelector(selector)) {
            return selector;
          }
        }
      }

      return null;
    },

    // 5. Estratégia: Caminho DOM com nth-of-type para precisão
    (): string | null => {
      const path: string[] = [];
      let currentNode: HTMLElement | null = element;

      while (currentNode && currentNode !== document.body && currentNode !== document.documentElement) {
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

          // Verificar se o seletor parcial já é único
          const partialPath = path.join(' > ');
          if (isValidUniqueSelector(partialPath)) {
            return partialPath;
          }
        } else {
          path.unshift(tag);
        }

        currentNode = currentNode.parentElement;
      }

      const fullPath = path.join(' > ');
      return isValidUniqueSelector(fullPath) ? fullPath : null;
    }
  ];

  // Tentar cada estratégia até encontrar um seletor válido
  for (const strategy of selectorStrategies) {
    const selector = strategy();
    if (selector) {
      return selector;
    }
  }

  // Se nenhuma estratégia funcionou, lançar um erro
  throw new Error('Não foi possível gerar um seletor único para o elemento fornecido');
};

export default createUniqueElementSelector;