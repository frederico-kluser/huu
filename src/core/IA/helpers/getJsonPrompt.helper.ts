import { TypeTypescript } from '../types/typescript.type';

const getTabSpace = (tabs: number): string => {
	let result = '';
	for (let i = 0; i < tabs; i++) {
		result += '\t';
	}
	return result;
};

const getJsonPrompt = (types: TypeTypescript[], tabs = 1): string => {
	let result = '';
	types.forEach((type) => {
		result += getTabSpace(tabs);
		if (type.propertyValue instanceof Object) {
			result += `${type.propertyName}: {\n`;
			result += getJsonPrompt([type.propertyValue as TypeTypescript], tabs + 1);
			result += getTabSpace(tabs);
			result += `}; // ${type.propertyComment}\n`;
		} else {
			result += `${type.propertyName}: ${type.propertyValue}${type.isArray ? '[]' : ''}, // ${type.propertyComment}\n`;
		}
	});

	if (tabs === 1) {
		return `{ \n${result}}`;
	} else {
		return result;
	}
};

export default getJsonPrompt;
