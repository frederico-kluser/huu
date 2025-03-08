import AIModel from '../enums/gptModel.enum.js';
import { ContentItem, TypeAIError, TypeTemperature } from '../types/gpt.type.js';
import getChatCompletion from './getChatCompletion.gpt.js';

export const getAIResponse = async ({
	question,
	model,
	max_tokens = null,
	temperature,
}: {
	question: string | ContentItem[];
	model: AIModel;
	max_tokens?: number | null;
	temperature?: TypeTemperature;
}): Promise<string | TypeAIError> =>
	await new Promise<string>((resolve) => {
		getChatCompletion({
			question,
			stream: false,
			model,
			max_tokens,
			temperature: temperature || 0.1,
		})
			.then(async (response) => {
				const data = await response.json();
				if (data?.choices === undefined) {
					resolve(data);
				} else {
					resolve(data.choices[0].message.content as string);
				}
			})
			.catch((error) => {
				console.log('error :', error);
				throw error;
			});
	});

export const generateResponse = async (
	prompt: string,
	temperature?: TypeTemperature,
	max_tokens?: number,
): Promise<string | TypeAIError> => {
	const response = await getAIResponse({
		question: prompt,
		model: AIModel.GPT4,
		max_tokens: max_tokens ?? null,
		temperature: temperature ?? 0.1,
	});

	return response;
};
