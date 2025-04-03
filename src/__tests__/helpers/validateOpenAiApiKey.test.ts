import validateOpenAIApiKey from '../../../src/helpers/validateOpenAiApiKey';

// Mock fetch global
global.fetch = jest.fn();

describe('validateOpenAIApiKey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deve retornar true para uma resposta bem-sucedida', async () => {
    // Mock de uma resposta bem-sucedida
    (global.fetch as jest.Mock).mockImplementationOnce(() => 
      Promise.resolve({
        status: 200,
        json: () => Promise.resolve({ data: 'success' })
      })
    );
    
    const result = await validateOpenAIApiKey('valid-key');
    
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer valid-key',
        'Content-Type': 'application/json',
      },
    });
  });

  it('deve retornar false para uma resposta de erro', async () => {
    // Mock de uma resposta de erro
    (global.fetch as jest.Mock).mockImplementationOnce(() => 
      Promise.resolve({
        status: 401,
        json: () => Promise.resolve({ error: 'Unauthorized' })
      })
    );
    
    const result = await validateOpenAIApiKey('invalid-key');
    
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('deve tratar exceções e retornar false', async () => {
    // Mock de uma exceção
    (global.fetch as jest.Mock).mockImplementationOnce(() => 
      Promise.reject(new Error('Network error'))
    );
    
    const result = await validateOpenAIApiKey('random-key');
    
    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});