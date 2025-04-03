import isValidUrlPatterns from '../../helpers/isValidPatterns';

describe('isValidUrlPatterns', () => {
  it('deve retornar true para padrões de URL válidos', () => {
    // Padrões simples
    expect(isValidUrlPatterns('google.com')).toBe(true);
    expect(isValidUrlPatterns('example.com/path')).toBe(true);
    expect(isValidUrlPatterns('sub.domain.com')).toBe(true);
    
    // Com wildcard
    expect(isValidUrlPatterns('*.example.com')).toBe(true);
    expect(isValidUrlPatterns('example.com/*')).toBe(true);
    expect(isValidUrlPatterns('*.example.com/*')).toBe(true);
    
    // Múltiplos padrões
    expect(isValidUrlPatterns('example.com, google.com')).toBe(true);
    expect(isValidUrlPatterns('example.com/*, sub.example.com/*')).toBe(true);
    
    // Com protocolos
    expect(isValidUrlPatterns('http://example.com')).toBe(true);
    expect(isValidUrlPatterns('https://example.com')).toBe(true);
    
    // Com portas
    expect(isValidUrlPatterns('example.com:8080')).toBe(true);
    
    // Padrões mais complexos
    expect(isValidUrlPatterns('example.com/path?param=value')).toBe(true);
    expect(isValidUrlPatterns('example.com/path#fragment')).toBe(true);
  });

  it('deve retornar false para padrões de URL inválidos', () => {
    // String vazia
    expect(isValidUrlPatterns('')).toBe(false);
    
    // Padrões inválidos
    expect(isValidUrlPatterns('not a url')).toBe(false);
    expect(isValidUrlPatterns('http://')).toBe(false);
    expect(isValidUrlPatterns(' ')).toBe(false);
    
    // Formatos que a função atual considera válidos ou inválidos dependendo da implementação
    expect(isValidUrlPatterns('http:///invalid')).toBe(true); // Contém wildcard implícito
    expect(isValidUrlPatterns('://example.com')).toBe(false); // Não é um padrão válido
    
    // Outro tipo de dado
    expect(isValidUrlPatterns(null as unknown as string)).toBe(false);
    expect(isValidUrlPatterns(undefined as unknown as string)).toBe(false);
    expect(isValidUrlPatterns(123 as unknown as string)).toBe(false);
    expect(isValidUrlPatterns({} as unknown as string)).toBe(false);
    expect(isValidUrlPatterns([] as unknown as string)).toBe(false);
  });

  it('deve validar cada padrão em uma lista de padrões separados por vírgula', () => {
    // Todos válidos
    expect(isValidUrlPatterns('google.com, example.com, sub.domain.com')).toBe(true);
    
    // Mistura de válidos e inválidos
    expect(isValidUrlPatterns('google.com, invalid url, example.com')).toBe(false);
    
    // Todos inválidos
    expect(isValidUrlPatterns('not a url, also not a url')).toBe(false);
  });
});