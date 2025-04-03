import { 
  fetchWorkspaceNames, 
  updateWorkspaceNames, 
  fetchActualWorkspaceName, 
  updateActualWorkspace 
} from '../../../core/storage/workspace';
import { getItem, setItem } from '../../../core/storage';

// Mock das funções de storage
jest.mock('../../../core/storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('Workspace Storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('fetchWorkspaceNames', () => {
    it('deve retornar um array vazio se não houver workspaces salvos', async () => {
      (getItem as jest.Mock).mockResolvedValueOnce(null);
      
      const result = await fetchWorkspaceNames();
      
      expect(result).toEqual([]);
      expect(getItem).toHaveBeenCalledWith('workspace');
    });

    it('deve retornar os nomes dos workspaces salvos', async () => {
      const mockWorkspaces = ['workspace1', 'workspace2'];
      (getItem as jest.Mock).mockResolvedValueOnce(mockWorkspaces);
      
      const result = await fetchWorkspaceNames();
      
      expect(result).toEqual(mockWorkspaces);
      expect(getItem).toHaveBeenCalledWith('workspace');
    });
  });

  describe('updateWorkspaceNames', () => {
    it('deve salvar os nomes dos workspaces', async () => {
      const workspaces = ['workspace1', 'workspace2'];
      
      await updateWorkspaceNames(workspaces);
      
      expect(setItem).toHaveBeenCalledWith('workspace', workspaces);
    });
  });

  describe('fetchActualWorkspaceName', () => {
    it('deve retornar o primeiro workspace se não houver workspace atual definido', async () => {
      // A implementação atual retorna o primeiro workspace quando o índice é nulo
      (getItem as jest.Mock).mockImplementation((key) => {
        if (key === 'workspace') return Promise.resolve(['workspace1', 'workspace2']);
        if (key === 'lastWorkspaceIndex') return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const result = await fetchActualWorkspaceName();
      
      expect(result).toBe('workspace1');
    });

    it('deve retornar o nome do workspace atual baseado no índice salvo', async () => {
      const mockWorkspaces = ['workspace1', 'workspace2'];
      const mockIndex = 1; // Apontando para 'workspace2'
      
      // Mock para getItem com comportamento diferente para diferentes chaves
      (getItem as jest.Mock).mockImplementation((key) => {
        if (key === 'workspace') return Promise.resolve(mockWorkspaces);
        if (key === 'lastWorkspaceIndex') return Promise.resolve(mockIndex);
        return Promise.resolve(null);
      });
      
      const result = await fetchActualWorkspaceName();
      
      expect(result).toBe('workspace2');
    });

    it('deve retornar uma string vazia se o índice for inválido', async () => {
      const mockWorkspaces = ['workspace1', 'workspace2'];
      const mockIndex = 5; // Índice fora do range
      
      // Mock para getItem
      (getItem as jest.Mock).mockImplementation((key) => {
        if (key === 'workspace') return Promise.resolve(mockWorkspaces);
        if (key === 'lastWorkspaceIndex') return Promise.resolve(mockIndex);
        return Promise.resolve(null);
      });
      
      const result = await fetchActualWorkspaceName();
      
      expect(result).toBe('');
    });
  });

  describe('updateActualWorkspace', () => {
    it('deve atualizar o índice do workspace atual', async () => {
      const index = 2;
      
      await updateActualWorkspace(index);
      
      expect(setItem).toHaveBeenCalledWith('lastWorkspaceIndex', index);
    });
  });
});