import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const nanoid = customAlphabet(alphabet, 8);

export function generateRunId(): string {
  return nanoid();
}
