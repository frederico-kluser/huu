import AIModel from '../enums/gptModel.enum.js';
import { ContentItem } from '../types/gpt.type.js';
import { getAIResponse } from './gpt.request.js';

const getAnalyzedImage = async (prompt: string, base64URL: string): Promise<string> => {
	const question: ContentItem[] = [
		{ type: 'text', text: prompt },
		{
			type: 'image_url',
			image_url: {
				url: base64URL,
			},
		},
	];

	const response = await getAIResponse({
		question,
		model: AIModel.GPT4,
		max_tokens: 100,
		temperature: 0.1,
	});
	return response as string;
};

export default getAnalyzedImage;
