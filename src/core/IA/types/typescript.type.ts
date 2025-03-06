export type TypeTypescript = {
	propertyName: string;
	propertyValue: 'string' | 'number' | 'boolean' | TypeTypescript;
	propertyComment: string;
	isArray: boolean;
};
