import enums from '../../../types/enums.js';
import { getItem } from '../../storage/index.js';
import { fetchRequestProps, GptMessage } from '../types/gpt.type.js';

const getChatCompletion = async ({
	history,
	max_tokens,
	model,
	question,
	stream,
	temperature = 0.1,
}: fetchRequestProps): Promise<Response> => {
	const messages: GptMessage[] = [...(history || []), { role: 'user', content: question }];

	const key = await getItem(enums.OPENAI_KEY) || 'no-key';

	return fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			model,
			messages,
			max_tokens,
			stream,
			temperature,
		}),
	});
};

export default getChatCompletion;
