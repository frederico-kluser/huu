import { Interpreter } from "eval5";
import { getConditionalAi, getGeneratedText, getSummarizedText, getTranslatedText } from "./IA";

const executeCode = (code: string) => {
    // Exponha TUDO que será usado no código do eval5
    const context = {
        chrome, // APIs da extensão
        console,
        fetch: window.fetch.bind(window),
        getConditionalAi,
        getGeneratedText,
        getSummarizedText,
        getTranslatedText,
        // Objetos do DOM com bind
        document: {
            ...document,
            getElementById: document.getElementById.bind(document),
            querySelector: document.querySelector.bind(document),
            createElement: document.createElement.bind(document),
            addEventListener: document.addEventListener.bind(document),
            getElementsByTagName: document.getElementsByTagName.bind(document),
            getElementsByClassName: document.getElementsByClassName.bind(document),
            getElementsByName: document.getElementsByName.bind(document),
            evaluate: document.evaluate.bind(document),
            body: document.body,
        },
        window: {
            ...window,
            alert: window.alert.bind(window),
            confirm: window.confirm.bind(window),
            addEventListener: window.addEventListener.bind(window),
            // Outras funções e propriedades necessárias
        },
        // Classes e construtores
        Event: window.Event,
        MouseEvent: window.MouseEvent,
        HTMLElement: window.HTMLElement,
        // Polyfills ou substitutos para funcionalidades ausentes
        setTimeout: (handler: TimerHandler, timeout?: number) => window.setTimeout(handler, timeout),
        clearTimeout: (handle: number) => window.clearTimeout(handle),
        setInterval: (handler: TimerHandler, timeout?: number) => window.setInterval(handler, timeout),
    };

    const interpreter = new Interpreter(context, { timeout: 0 });

    try {
        const result = interpreter.evaluate(code);
        console.log("Resultado da execução:", result);
    } catch (e) {
        console.error("Erro na execução do código:", e);
    }
};

export default executeCode;