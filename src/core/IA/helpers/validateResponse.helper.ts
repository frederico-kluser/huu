import { TypeTypescript } from '../types/typescript.type';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validateResponse(model: TypeTypescript[], response: any): boolean {
	for (const field of model) {
		const responseValue = response[field.propertyName];

		if (responseValue === undefined) {
			console.error(`Missing property: ${field.propertyName}`);
			return false;
		}

		if (field.isArray) {
			if (!Array.isArray(responseValue)) {
				console.error(`Property ${field.propertyName} should be an array`);
				return false;
			}

			for (const item of responseValue) {
				if (typeof field.propertyValue === 'object') {
					if (!validateResponse([field.propertyValue], item)) {
						return false;
					}
				} else if (typeof item !== field.propertyValue) {
					console.error(`Items in array ${field.propertyName} should be of type ${field.propertyValue}`);
					return false;
				}
			}
		} else {
			if (typeof field.propertyValue === 'object') {
				if (!validateResponse([field.propertyValue], responseValue)) {
					return false;
				}
			} else if (typeof responseValue !== field.propertyValue) {
				console.error(`Property ${field.propertyName} should be of type ${field.propertyValue}`);
				return false;
			}
		}
	}

	return true;
}

export default validateResponse;
