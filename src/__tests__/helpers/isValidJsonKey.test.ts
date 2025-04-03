import isValidJsonKey from '../../helpers/isValidJsonKey';

describe('isValidJsonKey', () => {
  it('deve retornar true para chaves JSON válidas', () => {
    expect(isValidJsonKey('validKey')).toBe(true);
    expect(isValidJsonKey('valid_key')).toBe(true);
    expect(isValidJsonKey('validKey123')).toBe(true);
    expect(isValidJsonKey('valid-key')).toBe(true);
    expect(isValidJsonKey('123validKey')).toBe(true);
  });

  it('deve retornar false para chaves JSON inválidas', () => {
    expect(isValidJsonKey('')).toBe(true); // String vazia (é uma chave válida em JSON)
    expect(isValidJsonKey('invalid key')).toBe(false); // Contém espaço
    expect(isValidJsonKey('invalid.key')).toBe(false); // Contém ponto
    expect(isValidJsonKey('invalid/key')).toBe(false); // Contém barra
    expect(isValidJsonKey('invalid\\key')).toBe(false); // Contém barra invertida
    expect(isValidJsonKey('invalid:key')).toBe(false); // Contém dois pontos
    expect(isValidJsonKey('invalid*key')).toBe(false); // Contém asterisco
    expect(isValidJsonKey('invalid?key')).toBe(false); // Contém ponto de interrogação
    expect(isValidJsonKey('invalid"key')).toBe(false); // Contém aspas
    expect(isValidJsonKey('invalid<key')).toBe(false); // Contém menor que
    expect(isValidJsonKey('invalid>key')).toBe(false); // Contém maior que
    expect(isValidJsonKey('invalid|key')).toBe(false); // Contém pipe
  });

  it('deve retornar false para entradas não string', () => {
    expect(isValidJsonKey(null as unknown as string)).toBe(false);
    expect(isValidJsonKey(undefined as unknown as string)).toBe(false);
    expect(isValidJsonKey(123 as unknown as string)).toBe(false);
    expect(isValidJsonKey({} as unknown as string)).toBe(false);
    expect(isValidJsonKey([] as unknown as string)).toBe(false);
  });
});