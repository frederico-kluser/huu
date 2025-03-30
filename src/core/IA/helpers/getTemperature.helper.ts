import { type TypeTemperature } from '../types/gpt.type';

const getTemperature = (index: number): TypeTemperature => {
	switch (index) {
		case 0:
			return 0.1;
		case 1:
			return 0.2;
		case 2:
			return 0.3;
		case 3:
			return 0.4;
		case 4:
			return 0.5;
		case 5:
			return 0.6;
		case 6:
			return 0.7;
		case 7:
			return 0.8;
		case 8:
			return 0.9;
		case 9:
			return 1;
		default:
			return 0.1;
	}
};

export default getTemperature;
