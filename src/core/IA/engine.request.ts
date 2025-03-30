import extractCodeBlocks from './helpers/extractCodeBlocks.helper';
import getJsonPrompt from './helpers/getJsonPrompt.helper';
import getTemperature from './helpers/getTemperature.helper';
import validateResponse from './helpers/validateResponse.helper';
import { generateResponse } from './request/gpt.request';
import { TypeTypescript } from './types/typescript.type';

export const generateResponseJSON = async <T>(
	prompt: string,
	responseFormat: TypeTypescript[],
): Promise<
	| {
		response: T;
		retries: number;
	}
	| {
		error: {
			code: string;
			message: string;
		};
	}
> => {
	let JsonParse: T = null as T;
	let temperature = 0;

	let finalPrompt = prompt;
	finalPrompt += '(retorne apenas o objeto JSON para a saída. apenas o código, sem avisos legais, sem blocos de código em markdown)\n\nNo seguinte formato:';
	finalPrompt += getJsonPrompt(responseFormat);

	let whileCondition = true;

	while (whileCondition) {
		if (temperature > 3) {
			throw new Error('Failed to generate a valid JSON response');
		}

		const result = await generateResponse(finalPrompt, getTemperature(temperature));


		if (typeof result === 'string') {
			const code = result as string;
			const { codeValue } = extractCodeBlocks(code)[0];

			try {
				JsonParse = JSON.parse(codeValue);
				whileCondition = false;
			} catch (error) {
				console.error('error', error);
			} finally {
				temperature += 1;
			}
		} else {
			const errorCode = result.error.code;

			switch (errorCode) {
				case 'insufficient_quota':
					return {
						error: {
							code: 'insufficient_quota',
							message: 'Sua cota de uso da IA foi excedida, contate o suporte',
						},
					};
				default:
					console.error('error', result.error);
					temperature += 1;
			}
		}
	}

	if (!validateResponse(responseFormat, JsonParse)) {
		return {
			error: {
				code: 'invalid_response',
				message: 'Falha ao gerar uma resposta válida, contate o suporte',
			},
		};
	}

	return {
		response: JsonParse,
		retries: temperature - 1,
	};
};
