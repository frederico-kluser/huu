import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateAgent from '../../../../../pages/Popup/pages/CreateAgent';
import validateOpenAIApiKey from '../../../../../helpers/validateOpenAiApiKey';
import { getItem, setItem } from '../../../../../core/storage';
import enums from '../../../../../types/enums';
import * as alertModule from '../../../../../helpers/ui/showAlert';

// Mock dos módulos
jest.mock('../../../../../helpers/validateOpenAiApiKey');
jest.mock('../../../../../core/storage');
jest.mock('../../../../../helpers/ui/showAlert', () => ({
  showAlert: jest.fn(),
  setupAlertReplacement: jest.fn()
}));

describe('CreateAgent Component', () => {
  // Props de teste
  const mockProps = {
    handleCreateAgent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (validateOpenAIApiKey as jest.Mock).mockResolvedValue(true);
    (getItem as jest.Mock).mockResolvedValue(null); // Sem chave existente por padrão
    
    // Garantir que o setItem retorne uma Promise
    (setItem as jest.Mock).mockImplementation(() => Promise.resolve());
    
    // Mock global de window.alert
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });
  
  afterEach(() => {
    // Limpar mock do alert após cada teste
    jest.restoreAllMocks();
  });

  it('deve renderizar o formulário corretamente', async () => {
    render(<CreateAgent {...mockProps} />);
    
    // Verificar elementos da UI
    expect(screen.getByText('huu')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente')).toBeInTheDocument();
    expect(screen.getByText('Para obter sua chave, acesse')).toBeInTheDocument();
    expect(screen.getByText('Depois de criar um agente, você pode editá-lo na página de edição de agentes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar Agente' })).toBeInTheDocument();
  });

  it('deve mostrar estado de carregamento durante a validação', async () => {
    // Simulamos a validação demorando um pouco
    (validateOpenAIApiKey as jest.Mock).mockImplementation(() => {
      return new Promise(resolve => setTimeout(() => resolve(true), 100));
    });
    
    render(<CreateAgent {...mockProps} />);
    
    // Inserir uma chave
    const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
    fireEvent.change(input, { target: { value: 'test-api-key' } });
    
    // Verificar que o estado de carregamento aparece
    await waitFor(() => {
      expect(screen.getByText('Validando chave da OpenAI...')).toBeInTheDocument();
    });
    
    // Verificar que o estado de carregamento desaparece após a conclusão
    await waitFor(() => {
      expect(screen.queryByText('Validando chave da OpenAI...')).not.toBeInTheDocument();
    });
  });

  it('deve validar a chave ao inserir', async () => {
    render(<CreateAgent {...mockProps} />);
    
    // Inserir uma chave
    const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
    fireEvent.change(input, { target: { value: 'test-api-key' } });
    
    // Verificar que a função de validação foi chamada
    await waitFor(() => {
      expect(validateOpenAIApiKey).toHaveBeenCalledWith('test-api-key');
    });
  });

  it('deve salvar a chave e chamar handleCreateAgent ao submeter', async () => {
    render(<CreateAgent {...mockProps} />);
    
    // Inserir uma chave
    const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
    fireEvent.change(input, { target: { value: 'test-api-key' } });
    
    // Aguardar validação
    await waitFor(() => {
      expect(validateOpenAIApiKey).toHaveBeenCalledWith('test-api-key');
    });
    
    // Clicar no botão de criar agente
    const button = screen.getByRole('button', { name: 'Criar Agente' });
    fireEvent.click(button);
    
    // Verificar que a chave foi salva e a função handleCreateAgent foi chamada
    await waitFor(() => {
      expect(setItem).toHaveBeenCalledWith(enums.OPENAI_KEY, 'test-api-key');
      expect(mockProps.handleCreateAgent).toHaveBeenCalled();
    });
  });

  it('deve desativar o botão se a chave for inválida', async () => {
    (validateOpenAIApiKey as jest.Mock).mockResolvedValue(false);
    
    render(<CreateAgent {...mockProps} />);
    
    // Inserir uma chave inválida
    const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
    fireEvent.change(input, { target: { value: 'invalid-key' } });
    
    // Verificar que o botão está desativado após a validação
    await waitFor(() => {
      const button = screen.getByRole('button', { name: 'Criar Agente' });
      expect(button).toBeDisabled();
    });
  });

  it('deve pré-carregar e validar uma chave existente', async () => {
    // Simular uma chave existente
    (getItem as jest.Mock).mockResolvedValue('existing-api-key');
    
    render(<CreateAgent {...mockProps} />);
    
    // Verificar que a chave foi carregada e validada
    await waitFor(() => {
      expect(getItem).toHaveBeenCalledWith(enums.OPENAI_KEY);
      expect(validateOpenAIApiKey).toHaveBeenCalledWith('existing-api-key');
      
      const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
      expect(input).toHaveValue('existing-api-key');
    });
  });

  it('deve mostrar alerta para chaves inválidas', async () => {
    // Chave inválida
    (validateOpenAIApiKey as jest.Mock).mockResolvedValue(false);
    
    render(<CreateAgent {...mockProps} />);
    
    // Inserir uma chave inválida
    const input = screen.getByPlaceholderText('Insira sua chave da OpenAI para criar um agente');
    fireEvent.change(input, { target: { value: 'invalid-key' } });
    
    // Verificar que a função showAlert foi chamada em vez de window.alert
    await waitFor(() => {
      expect(alertModule.showAlert).toHaveBeenCalledWith('Chave inválida', 'danger');
    });
  });
});