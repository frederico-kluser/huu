import React from 'react';
import { render } from '@testing-library/react';
import Gap from '../../../components/Gap';

describe('Gap Component', () => {
  it('deve renderizar com orientação horizontal e tamanho padrão', () => {
    const { container } = render(
      <Gap horizontal>
        <div>Item 1</div>
        <div>Item 2</div>
      </Gap>
    );
    
    const gapElement = container.firstChild;
    expect(gapElement).toHaveStyle({
      display: 'flex',
      gap: '8px',
    });
  });

  it('deve renderizar com orientação vertical quando horizontal não é fornecido', () => {
    const { container } = render(
      <Gap>
        <div>Item 1</div>
        <div>Item 2</div>
      </Gap>
    );
    
    const gapElement = container.firstChild;
    expect(gapElement).toHaveStyle({
      display: 'grid',
      gap: '8px',
    });
  });

  it('deve aplicar o tamanho personalizado', () => {
    const { container } = render(
      <Gap size={16}>
        <div>Item 1</div>
        <div>Item 2</div>
      </Gap>
    );
    
    const gapElement = container.firstChild;
    expect(gapElement).toHaveStyle({
      gap: '16px',
    });
  });

  it('deve renderizar os filhos corretamente', () => {
    const { getByText } = render(
      <Gap>
        <div>Item 1</div>
        <div>Item 2</div>
        <div>Item 3</div>
      </Gap>
    );
    
    expect(getByText('Item 1')).toBeInTheDocument();
    expect(getByText('Item 2')).toBeInTheDocument();
    expect(getByText('Item 3')).toBeInTheDocument();
  });

  it('deve permitir props adicionais para serem passadas', () => {
    const { container } = render(
      <Gap className="custom-class" data-testid="gap-component">
        <div>Item 1</div>
      </Gap>
    );
    
    const gapElement = container.firstChild;
    expect(gapElement).toHaveClass('custom-class');
    expect(gapElement).toHaveAttribute('data-testid', 'gap-component');
  });
});