import extractCodeBlocks from './helpers/extractCodeBlocks.helper.js';
import getJsonPrompt from './helpers/getJsonPrompt.helper.js';
import getTemperature from './helpers/getTemperature.helper.js';
import validateResponse from './helpers/validateResponse.helper.js';
import { generateResponse } from './request/gpt.request.js';
import { TypeTypescript } from './types/typescript.type.js';

const getPromptFormatInstructions = (english: boolean) => {
	let response = '\n\n';

	response += english
		? '(return only JSON object for output. just the code, no disclaimers, no markdown code blocks)\n\nIn the following format:'
		: '(retorne apenas o objeto JSON para a saída. apenas o código, sem avisos legais, sem blocos de código em markdown)\n\nNo seguinte formato:';

	response += '\n';

	return response;
};

export const generateResponseJSON = async <T>(
	prompt: string,
	responseFormat: TypeTypescript[],
	noPromptOptimization = false,
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
	finalPrompt += getPromptFormatInstructions(noPromptOptimization);
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
