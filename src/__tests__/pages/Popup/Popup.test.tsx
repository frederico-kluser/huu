import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import Popup from '../../../pages/Popup/Popup';
import * as workspaceStorage from '../../../core/storage/workspace';
import * as popupNavigationStorage from '../../../core/storage/popupNavigation';
import * as blockly from '../../../blockly';

// Mock dos módulos
jest.mock('../../../core/storage/workspace');
jest.mock('../../../core/storage/popupNavigation');
jest.mock('../../../blockly', () => ({
  blocklySetup: jest.fn(),
  loadWorkspace: jest.fn(),
}));

// Silenciar logs durante testes
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

describe('Popup Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock do chrome.tabs.query
    global.chrome.tabs.query.mockImplementation((_, callback) => {
      callback([{ url: 'https://example.com/test' }]);
    });

    // Mock do chrome.storage.local.get
    global.chrome.storage.local.get.mockImplementation((key, callback) => {
      const data = {
        openaiKey: JSON.stringify({ value: 'test-api-key', expiry: -1 })
      };
      
      if (typeof callback === 'function') {
        callback(typeof key === 'string' ? { [key]: data[key] } : data);
      }
      
      return Promise.resolve(typeof key === 'string' ? { [key]: data[key] } : data);
    });
    
    // Mock das funções do storage
    (workspaceStorage.fetchWorkspaceNames as jest.Mock).mockResolvedValue(['Agent1', 'Agent2']);
    (workspaceStorage.updateWorkspaceNames as jest.Mock).mockResolvedValue(undefined);
    (popupNavigationStorage.fetchPopupNavigation as jest.Mock).mockResolvedValue('');
    (popupNavigationStorage.updatePopupNavigation as jest.Mock).mockResolvedValue(undefined);
  });

  it('deve renderizar a página principal quando não há workspace atual', async () => {
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que carrega o componente MainPage
    await waitFor(() => {
      expect(screen.getByText('huu')).toBeInTheDocument();
    });
  });

  it('deve renderizar a página CreateAgent quando não há workspaces', async () => {
    // Não há workspaces
    (workspaceStorage.fetchWorkspaceNames as jest.Mock).mockResolvedValue([]);
    
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que carrega o componente CreateAgent
    await waitFor(() => {
      expect(screen.getByText('Para obter sua chave, acesse')).toBeInTheDocument();
    });
  });

  it('deve renderizar o Blockly quando há workspace atual', async () => {
    // Há um workspace atual
    (popupNavigationStorage.fetchPopupNavigation as jest.Mock).mockResolvedValue('Agent1');
    
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que o container Blockly é renderizado
    await waitFor(() => {
      const blocklyDiv = document.getElementById('blocklyDiv');
      expect(blocklyDiv).toBeInTheDocument();
      expect(screen.getByText('Voltar')).toBeInTheDocument();
    });
    
    // Verificar que o blockly é configurado
    await waitFor(() => {
      expect(blockly.blocklySetup).toHaveBeenCalled();
      expect(blockly.loadWorkspace).toHaveBeenCalledWith('Agent1');
    });
  });

  it('deve renderizar o botão de modo grande quando não está no modo grande', async () => {
    // Há um workspace atual
    (popupNavigationStorage.fetchPopupNavigation as jest.Mock).mockResolvedValue('Agent1');
    
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que o botão de modo grande é renderizado
    await waitFor(() => {
      expect(screen.getByText('Abrir modo grande')).toBeInTheDocument();
    });
  });

  it('não deve renderizar o botão de modo grande quando está no modo grande', async () => {
    // Simulamos estar no modo grande modificando o URL
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, search: '?large=true' };
    
    // Há um workspace atual
    (popupNavigationStorage.fetchPopupNavigation as jest.Mock).mockResolvedValue('Agent1');
    
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que o botão de modo grande não é renderizado
    await waitFor(() => {
      expect(screen.queryByText('Abrir modo grande')).not.toBeInTheDocument();
    });
    
    // Restauramos o location original
    window.location = originalLocation;
  });

  it('deve criar elemento de estilo para modo grande', async () => {
    // Simulamos estar no modo grande modificando o URL
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, search: '?large=true' };
    
    // Espionar appendChild do document.head
    const appendChildSpy = jest.spyOn(document.head, 'appendChild');
    
    // Há um workspace atual
    (popupNavigationStorage.fetchPopupNavigation as jest.Mock).mockResolvedValue('Agent1');
    
    await act(async () => {
      render(<Popup />);
    });
    
    // Verificar que um elemento de estilo foi adicionado ao head
    await waitFor(() => {
      expect(appendChildSpy).toHaveBeenCalled();
      const styleElement = appendChildSpy.mock.calls.find(call => 
        call[0] instanceof HTMLStyleElement && 
        call[0].textContent?.includes('max-width: initial')
      )?.[0];
      expect(styleElement).toBeDefined();
      expect(styleElement.tagName).toBe('STYLE');
    });
    
    // Restauramos o location original e removemos o spy
    window.location = originalLocation;
    appendChildSpy.mockRestore();
  });
});