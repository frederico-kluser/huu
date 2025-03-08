import { Interpreter } from "eval5";
import { getSummarizedText } from "./IA";

const executeCode = (code: string) => {
    // Cria um contexto customizado onde você pode expor funções e objetos necessários.
    // Por exemplo, você pode incluir funções de manipulação do DOM, eventos, etc.

    const context = {
        // Expondo algumas funções úteis
        chrome,
        console,
        fetch: window.fetch,
        XMLHttpRequest: window.XMLHttpRequest,
        getSummarizedText,
        window: {
            ...window,
            fetch: window.fetch.bind(window), // Exponha o fetch real
            XMLHttpRequest: window.XMLHttpRequest, // Exponha o XMLHttpRequest real
            Promise: window.Promise, // Garanta que Promise está disponível
        },
        // Você pode adicionar outras funções personalizadas aqui,
        // por exemplo, para manipular a DOM ou interagir com eventos.
        // document, addEventListener, etc., podem ser expostos com cuidado.
    };

    // Cria um novo interpretador com o contexto customizado e define um timeout (em milissegundos)
    const interpreter = new Interpreter(context, { timeout: 0 });

    try {
        const result = interpreter.evaluate(code);
        console.log("Resultado da execução:", result);
    } catch (e) {
        console.error("Erro na execução do código:", e);
    }
};

export default executeCode;
