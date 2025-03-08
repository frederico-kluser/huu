import { Interpreter } from "eval5";
import { getConditionalAi, getGeneratedText } from "./IA";

const executeCode = (code: string) => {
    // Cria um contexto customizado onde você pode expor funções e objetos necessários.
    // Por exemplo, você pode incluir funções de manipulação do DOM, eventos, etc.

    // generateResponseJSON

    const context = {
        // Expondo algumas funções úteis
        console,
        window,
        getConditionalAi,
        getGeneratedText,
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
