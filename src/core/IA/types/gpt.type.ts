import type AIModel from '../enums/gptModel.enum';

export type TypeTemperature = 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1;

export interface ContentItemText {
	type: 'text';
	text: string;
}

export interface ContentItemImage {
	type: 'image_url';
	image_url: {
		url: string;
	};
}

export interface GptMessage {
	role: 'assistant' | 'user';
	content: string | ContentItem[];
}

export type ContentItem = ContentItemText | ContentItemImage;

export interface TypeOpenAI {
	prompt: string;
	type: string;
	max_tokens?: number | null;
	temperature?: TypeTemperature;
}

export interface fetchRequestProps {
	history?: GptMessage[];
	max_tokens: number | null;
	model: AIModel;
	question: string | ContentItem[];
	stream: boolean;
	temperature?: TypeTemperature;
}

export interface TypeBooleanResponse {
	response: boolean;
}

export type TypeAIError = {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string;
	};
};
