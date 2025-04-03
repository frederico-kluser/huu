import urlMatchesPattern from '../../helpers/urlMatchePattern';

describe('urlMatchesPattern', () => {
  describe('URLs sem wildcard', () => {
    it('deve corresponder a URLs exatos', () => {
      expect(urlMatchesPattern('https://example.com', 'example.com')).toBe(true);
      expect(urlMatchesPattern('https://example.com/path', 'example.com/path')).toBe(true);
      expect(urlMatchesPattern('https://sub.example.com', 'sub.example.com')).toBe(true);
    });

    it('não deve corresponder a URLs diferentes', () => {
      expect(urlMatchesPattern('https://example.com', 'different.com')).toBe(false);
      expect(urlMatchesPattern('https://example.com/path', 'example.com/different')).toBe(false);
      expect(urlMatchesPattern('https://sub.example.com', 'othersub.example.com')).toBe(false);
    });
  });

  describe('URLs com wildcard em domínio', () => {
    it('deve corresponder a qualquer subdomínio', () => {
      expect(urlMatchesPattern('https://sub.example.com', '*.example.com')).toBe(true);
      expect(urlMatchesPattern('https://another.sub.example.com', '*.example.com')).toBe(true);
      expect(urlMatchesPattern('https://example.com', '*.example.com')).toBe(false); // Não corresponde ao domínio raiz
    });
  });

  describe('URLs com wildcard em caminho', () => {
    it('deve corresponder a qualquer caminho', () => {
      expect(urlMatchesPattern('https://example.com/any/path', 'example.com/*')).toBe(true);
      expect(urlMatchesPattern('https://example.com/another/path', 'example.com/*')).toBe(true);
      expect(urlMatchesPattern('https://example.com', 'example.com/*')).toBe(false); // A regex atual exige algo após o *
    });
  });

  describe('URLs com wildcards em domínio e caminho', () => {
    it('deve corresponder a qualquer subdomínio e qualquer caminho', () => {
      expect(urlMatchesPattern('https://sub.example.com/any/path', '*.example.com/*')).toBe(true);
      expect(urlMatchesPattern('https://another.sub.example.com/different', '*.example.com/*')).toBe(true);
      expect(urlMatchesPattern('https://example.com/path', '*.example.com/*')).toBe(false); // Não corresponde ao domínio raiz
    });
  });

  describe('Múltiplos padrões', () => {
    it('deve corresponder se qualquer padrão corresponder', () => {
      expect(urlMatchesPattern('https://example.com', 'google.com, example.com')).toBe(true);
      expect(urlMatchesPattern('https://sub.example.com', 'google.com, *.example.com')).toBe(true);
      expect(urlMatchesPattern('https://different.com', 'google.com, example.com')).toBe(false);
    });
  });

  describe('Casos especiais', () => {
    it('deve lidar com entradas inválidas', () => {
      expect(urlMatchesPattern('', 'example.com')).toBe(false); // URL vazia
      expect(urlMatchesPattern('https://example.com', '')).toBe(false); // Padrão vazio
      expect(urlMatchesPattern('invalid-url', 'example.com')).toBe(false); // URL inválida
    });

    it('deve lidar com URLs com protocolo especificado no padrão', () => {
      expect(urlMatchesPattern('https://example.com', 'https://example.com')).toBe(true);
      expect(urlMatchesPattern('http://example.com', 'https://example.com')).toBe(true); // A implementação atual normaliza URLs removendo o protocolo
    });

    it('deve lidar com URLs com porta', () => {
      expect(urlMatchesPattern('https://example.com:8080', 'example.com:8080')).toBe(true);
      expect(urlMatchesPattern('https://example.com', 'example.com:8080')).toBe(false); // Não deve corresponder porta diferente
    });

    it('deve verificar correspondência exata quando não há wildcard', () => {
      expect(urlMatchesPattern('https://example.com/path/subpath', 'example.com/path')).toBe(false); // A implementação exige correspondência exata
      expect(urlMatchesPattern('https://example.com/path', 'example.com/path')).toBe(true); // Correspondência exata
      expect(urlMatchesPattern('https://example.com/different/path', 'example.com/path')).toBe(false); // Não corresponde
    });
  });
});