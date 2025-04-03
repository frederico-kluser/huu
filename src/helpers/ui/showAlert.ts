import React from 'react';
import ReactDOM from 'react-dom';

/**
 * Exibe um alerta do Bootstrap em vez do alert padrão
 * 
 * @param message Mensagem a ser exibida
 * @param type Tipo de alerta (success, info, warning, danger)
 * @param timeout Tempo em ms até o alerta desaparecer (padrão: 3000ms)
 */
export const showAlert = (message: string, type: 'success' | 'info' | 'warning' | 'danger' = 'info', timeout: number = 3000): void => {
  // Criar um contêiner para o alerta se ainda não existir
  let alertContainer = document.getElementById('huu-alert-container');
  
  if (!alertContainer) {
    alertContainer = document.createElement('div');
    alertContainer.id = 'huu-alert-container';
    alertContainer.style.position = 'fixed';
    alertContainer.style.top = '20px';
    alertContainer.style.right = '20px';
    alertContainer.style.zIndex = '9999';
    alertContainer.style.maxWidth = '350px';
    document.body.appendChild(alertContainer);
  }

  // Criar o elemento para o alerta
  const alertElement = document.createElement('div');
  alertElement.className = `alert alert-${type} alert-dismissible fade show`;
  alertElement.role = 'alert';
  alertElement.style.marginBottom = '10px';
  alertElement.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
  
  // Adicionar o conteúdo do alerta
  alertElement.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
  `;
  
  // Adicionar o alerta ao contêiner
  alertContainer.appendChild(alertElement);
  
  // Inicializar o comportamento do botão de fechar
  const closeButton = alertElement.querySelector('.btn-close');
  closeButton?.addEventListener('click', () => {
    alertElement.classList.remove('show');
    setTimeout(() => {
      alertContainer?.removeChild(alertElement);
    }, 150);
  });
  
  // Configurar o timeout para autofechamento
  if (timeout > 0) {
    setTimeout(() => {
      if (alertContainer?.contains(alertElement)) {
        alertElement.classList.remove('show');
        setTimeout(() => {
          if (alertContainer?.contains(alertElement)) {
            alertContainer.removeChild(alertElement);
          }
        }, 150);
      }
    }, timeout);
  }
};

/**
 * Replace global window.alert with bootstrap alert
 */
export const setupAlertReplacement = (): void => {
  // Salva a referência original do alert
  const originalAlert = window.alert;
  
  // Substitui o window.alert pelo nosso alerta personalizado
  window.alert = (message: string) => {
    // Para blocos de injeção, devemos verificar se estamos na extensão
    const isExtensionContext = document.getElementById('root') && 
                             document.querySelector('[data-testid="blocklyDiv"]');
    
    if (isExtensionContext) {
      showAlert(message);
    } else {
      // Caso seja código injetado no site, usa o alert original
      originalAlert(message);
    }
  };
};

export default showAlert;