import { generateResponseJSON } from "./engine.request";
import getTemperature from "./helpers/getTemperature.helper";
import { generateResponse } from "./request/gpt.request";

export const getConditionalAi = async (booleanQuestion: string, callback: (bool: boolean) => {}) => {
    const data = await generateResponseJSON<{
        bool: boolean;
    }>(`Considerando o seguinte texto """${booleanQuestion}""" como uma questão booleana, qual seria sua resposta ?"`, [
        {
            isArray: false,
            propertyName: 'bool',
            propertyValue: 'boolean',
            propertyComment: 'A resposta deve ser booleana mesmo que a questão não seja uma pergunta booleana'
        }
    ]);


    if ('error' in data) {
        console.error('error', data.error);
        throw new Error('Erro ao obter resposta condicional');
    }

    callback(data.response.bool);
};

export const getGeneratedText = async (prompt: string): Promise<string> => {
    const result = await generateResponse(prompt, getTemperature(0));

    if (typeof result === 'string') {
        return result;
    } else {
        console.error('Erro ao gerar texto:', result);
        return '';
    }
};

export const getSummarizedText = async (text: string, callback: (summary: string) => {}): Promise<void> => {
    const data = await generateResponseJSON<{
        summary: string;
    }>(`Resuma o texto a seguir: """${text}"""`, [
        {
            isArray: false,
            propertyName: 'summary',
            propertyValue: 'string',
            propertyComment: 'O resumo do texto'
        }
    ]);

    if ('error' in data) {
        console.error('error', data.error);
        throw new Error('Erro ao obter resumo');
    }

    callback(data.response.summary);
};

type TypeLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'ja' | 'ko' | 'ru' | 'zh-CN' | 'zh-TW';

export const getTranslatedText = async (text: string, targetLanguage: TypeLanguage): Promise<string> => {
    const data = await generateResponseJSON<{
        translatedText: string;
    }>(`Traduza o texto a seguir para "${targetLanguage}": """${text}"""`, [
        {
            isArray: false,
            propertyName: 'translatedText',
            propertyValue: 'string',
            propertyComment: `O texto traduzido para "${targetLanguage}"`
        }
    ]);

    if ('error' in data) {
        console.error('error', data.error);
        return '';
    }

    return data.response.translatedText;
};