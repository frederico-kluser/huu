import { generateResponseJSON } from "./engine.request";
import getTemperature from "./helpers/getTemperature.helper";
import { generateResponse } from "./request/gpt.request";

export const getConditionalAi = (
    booleanQuestion: string,
    callback?: (result: boolean) => void
): void => {
    generateResponseJSON<{
        bool: boolean;
    }>(`Considerando o seguinte texto """${booleanQuestion}""" como uma questão booleana, qual seria sua resposta ?"`, [
        {
            isArray: false,
            propertyName: 'bool',
            propertyValue: 'boolean',
            propertyComment: 'A resposta deve ser booleana mesmo que a questão não seja uma pergunta booleana'
        }
    ]).then(data => {
        let result = false;

        if (!('error' in data)) {
            result = data.response.bool;
        } else {
            console.error('error', data.error);
        }

        if (callback) {
            callback(result);
        }
    }).catch(error => {
        console.error('error', error);
        if (callback) {
            callback(false);
        }
    });
};

export const getGeneratedText = (
    prompt: string,
    callback?: (result: string) => void
): void => {
    generateResponse(prompt, getTemperature(0))
        .then(result => {
            let textResult = '';

            if (typeof result === 'string') {
                textResult = result;
            } else {
                console.error('Erro ao gerar texto:', result);
            }

            if (callback) {
                callback(textResult);
            }
        })
        .catch(error => {
            console.error('Erro ao gerar texto:', error);
            if (callback) {
                callback('');
            }
        });
};

export const getSummarizedText = (
    text: string,
    callback?: (result: string) => void
): void => {
    generateResponseJSON<{
        summary: string;
    }>(`Resuma o texto a seguir: """${text}"""`, [
        {
            isArray: false,
            propertyName: 'summary',
            propertyValue: 'string',
            propertyComment: 'O resumo do texto'
        }
    ]).then(data => {
        let result = '';

        if (!('error' in data)) {
            result = data.response.summary;
        } else {
            console.error('error', data.error);
        }

        if (callback) {
            callback(result);
        }
    }).catch(error => {
        console.error('error', error);
        if (callback) {
            callback('');
        }
    });
};

type TypeLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'ru' | 'zh-CN' | 'zh-TW';

export const getTranslatedText = (
    text: string,
    targetLanguage: TypeLanguage,
    callback?: (result: string) => void
): void => {
    generateResponseJSON<{
        translatedText: string;
    }>(`Traduza o texto a seguir para "${targetLanguage}": """${text}"""`, [
        {
            isArray: false,
            propertyName: 'translatedText',
            propertyValue: 'string',
            propertyComment: `O texto traduzido para "${targetLanguage}"`
        }
    ]).then(data => {
        let result = '';

        if (!('error' in data)) {
            result = data.response.translatedText;
        } else {
            console.error('error', data.error);
        }

        if (callback) {
            callback(result);
        }
    }).catch(error => {
        console.error('error', error);
        if (callback) {
            callback('');
        }
    });
};