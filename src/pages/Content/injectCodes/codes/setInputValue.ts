const setInputValue = (element: HTMLInputElement, value: string): HTMLInputElement => {
    // Foca o elemento (importante para alguns frameworks)
    element.focus();

    // Define o valor
    element.value = value;

    // Cria e dispara evento input (importante para React)
    const inputEvent = new Event('input', { bubbles: true });
    element.dispatchEvent(inputEvent);

    // Cria e dispara evento change (importante para Angular e outros)
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);

    // Remove o foco para finalizar
    element.blur();

    return element;
}

export default setInputValue;