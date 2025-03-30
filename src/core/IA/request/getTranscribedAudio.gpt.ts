// @ts-nocheck
import axios from 'axios';
import FormData from 'form-data';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import convertAudioToMp3 from '../../utils/convertAudioToMp3.js';
import { EnvKeys } from '../enums/password.enum.js';

ffmpeg.setFfmpegPath(ffmpegStatic as string);

export interface AudioObject {
	mimetype: string;
	data: string;
	filename?: string;
	filesize?: number;
}

const getTranscribedAudio = async (audioObject: AudioObject): Promise<void> => {
	try {
		const { data: base64Data } = audioObject;
		const audioBuffer = Buffer.from(base64Data, 'base64');

		const mp3Buffer = await convertAudioToMp3(audioBuffer, audioObject.mimetype);

		const formData = new FormData();
		formData.append('file', mp3Buffer, {
			filename: 'audio.mp3',
			contentType: 'audio/mpeg',
		});
		formData.append('model', 'whisper-1');

		const response = await axios.post<{
			text: string;
		}>('https://api.openai.com/v1/audio/transcriptions', formData, {
			headers: {
				Authorization: `Bearer ${EnvKeys.NEXT_PUBLIC_OPENAI_KEY}`,
				...formData.getHeaders(),
			},
		});

		return response.data.text;
	} catch (error) {
		console.error(error);
	}
};

export default getTranscribedAudio;
