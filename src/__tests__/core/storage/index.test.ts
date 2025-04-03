import { setItem, getItem, removeItem } from '../../../core/storage';

// Mock da API chrome.storage
const mockChromeStorage = {
  local: {
    set: jest.fn().mockImplementation((items, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
    get: jest.fn().mockImplementation((key, callback) => {
      const mockData = {};
      if (callback) callback(mockData);
      return Promise.resolve(mockData);
    }),
    remove: jest.fn().mockImplementation((key, callback) => {
      if (callback) callback();
      return Promise.resolve();
    }),
  },
};

// Sobrescrever o objeto chrome.storage
global.chrome = {
  ...global.chrome,
  storage: mockChromeStorage,
};

describe('Storage - Core', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setItem', () => {
    it('deve salvar um item no storage com validade definida', async () => {
      const key = 'testKey';
      const value = { name: 'Test' };
      const ttl = 1000; // 1 segundo

      await setItem(key, value, ttl);

      expect(mockChromeStorage.local.set).toHaveBeenCalledTimes(1);
      const storageArg = mockChromeStorage.local.set.mock.calls[0][0];
      
      // Verificar o formato do objeto gravado
      expect(storageArg).toHaveProperty(key);
      
      // Verificar se o valor foi convertido para string (JSON)
      const storedItem = JSON.parse(storageArg[key]);
      expect(storedItem).toHaveProperty('value', value);
      expect(storedItem).toHaveProperty('expiry');
      expect(storedItem.expiry).toBeGreaterThan(Date.now());
    });

    it('deve salvar um item no storage sem validade', async () => {
      const key = 'testKey';
      const value = { name: 'Test' };

      await setItem(key, value);

      expect(mockChromeStorage.local.set).toHaveBeenCalledTimes(1);
      const storageArg = mockChromeStorage.local.set.mock.calls[0][0];
      
      // Verificar se o valor foi convertido para string (JSON)
      const storedItem = JSON.parse(storageArg[key]);
      expect(storedItem).toHaveProperty('value', value);
      expect(storedItem).toHaveProperty('expiry', -1);
    });
  });

  describe('getItem', () => {
    it('deve retornar null se o item não existir', async () => {
      mockChromeStorage.local.get.mockImplementationOnce(() => Promise.resolve({}));
      
      const result = await getItem('nonExistentKey');
      
      expect(result).toBeNull();
      expect(mockChromeStorage.local.get).toHaveBeenCalledTimes(1);
    });

    it('deve retornar o valor se o item existir e não estiver expirado', async () => {
      const key = 'testKey';
      const value = { name: 'Test' };
      const mockStoredData = {
        value,
        expiry: -1, // Sem expiração
      };
      
      mockChromeStorage.local.get.mockImplementationOnce(() => 
        Promise.resolve({ [key]: JSON.stringify(mockStoredData) })
      );
      
      const result = await getItem(key);
      
      expect(result).toEqual(value);
      expect(mockChromeStorage.local.get).toHaveBeenCalledTimes(1);
    });

    it('deve remover e retornar null se o item estiver expirado', async () => {
      const key = 'testKey';
      const value = { name: 'Test' };
      const mockStoredData = {
        value,
        expiry: Date.now() - 1000, // Já expirou
      };
      
      mockChromeStorage.local.get.mockImplementationOnce(() => 
        Promise.resolve({ [key]: JSON.stringify(mockStoredData) })
      );
      
      const result = await getItem(key);
      
      expect(result).toBeNull();
      expect(mockChromeStorage.local.get).toHaveBeenCalledTimes(1);
      expect(mockChromeStorage.local.remove).toHaveBeenCalledTimes(1);
      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith(key);
    });

    it('deve tratar erro ao fazer parse do JSON', async () => {
      const key = 'testKey';
      
      mockChromeStorage.local.get.mockImplementationOnce(() => 
        Promise.resolve({ [key]: 'invalid-json' })
      );
      
      const result = await getItem(key);
      
      expect(result).toBeNull();
      expect(mockChromeStorage.local.get).toHaveBeenCalledTimes(1);
      // Não deve chamar remove neste caso
      expect(mockChromeStorage.local.remove).not.toHaveBeenCalled();
    });
  });

  describe('removeItem', () => {
    it('deve remover um item do storage', async () => {
      const key = 'testKey';
      
      await removeItem(key);
      
      expect(mockChromeStorage.local.remove).toHaveBeenCalledTimes(1);
      expect(mockChromeStorage.local.remove).toHaveBeenCalledWith(key);
    });
  });
});