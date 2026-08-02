import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRANSCRIBE_MODEL,
  MAX_AUDIO_BASE64_CHARS,
  TranscribeError,
  isTranscribeFormat,
  transcribeAudio,
} from './transcribe.js';

function okResponse(content: unknown, usage?: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('isTranscribeFormat', () => {
  it('accepts the formats OpenRouter documents', () => {
    for (const f of ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac', 'aiff', 'pcm16', 'pcm24']) {
      expect(isTranscribeFormat(f)).toBe(true);
    }
  });

  // The one that matters: a browser's MediaRecorder defaults to webm/opus,
  // which OpenRouter rejects. The client re-encodes to wav because of this.
  it('rejects webm and other non-accepted containers', () => {
    for (const f of ['webm', 'opus', 'mp4', '', 'WAV', undefined, 42]) {
      expect(isTranscribeFormat(f)).toBe(false);
    }
  });
});

describe('transcribeAudio', () => {
  it('posts the OpenRouter input_audio shape and returns the text', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      okResponse('  migrate the parser to streaming  '),
    );

    const result = await transcribeAudio({
      audioBase64: 'AAAA',
      format: 'wav',
      apiKey: 'sk-or-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.text).toBe('migrate the parser to streaming');
    expect(result.modelId).toBe(DEFAULT_TRANSCRIBE_MODEL);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe(DEFAULT_TRANSCRIBE_MODEL);
    expect(body.temperature).toBe(0);
    const parts = body.messages[0].content;
    expect(parts[0].type).toBe('text');
    expect(parts[1]).toEqual({ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } });
  });

  it('honors a model override', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => okResponse('ok'));
    const result = await transcribeAudio({
      audioBase64: 'AAAA',
      format: 'ogg',
      apiKey: 'k',
      modelId: 'google/gemini-2.5-flash',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.modelId).toBe('google/gemini-2.5-flash');
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body)).model).toBe(
      'google/gemini-2.5-flash',
    );
  });

  it('reads the content-parts array shape too', async () => {
    const fetchImpl = vi.fn(async () => okResponse([{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }]));
    const result = await transcribeAudio({
      audioBase64: 'AAAA',
      format: 'wav',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.text).toBe('hello world');
  });

  it('surfaces the reported cost when present', async () => {
    const fetchImpl = vi.fn(async () => okResponse('x', { cost: 0.00006825 }));
    const result = await transcribeAudio({
      audioBase64: 'AAAA',
      format: 'wav',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.cost).toBeCloseTo(0.00006825);
  });

  it('rejects a missing key without calling out', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribeAudio({ audioBase64: 'AAAA', format: 'wav', apiKey: '  ', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(TranscribeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects empty audio', async () => {
    await expect(
      transcribeAudio({ audioBase64: '', format: 'wav', apiKey: 'k', fetchImpl: (async () => okResponse('x')) as unknown as typeof fetch }),
    ).rejects.toThrow(/no audio data/);
  });

  it('rejects a clip over the size cap before spending anything', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribeAudio({
        audioBase64: 'A'.repeat(MAX_AUDIO_BASE64_CHARS + 1),
        format: 'wav',
        apiKey: 'k',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/too large/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces the provider error message, not just the status', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No endpoints found that support audio input' } }), {
          status: 404,
        }),
    );
    await expect(
      transcribeAudio({ audioBase64: 'AAAA', format: 'wav', apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/No endpoints found that support audio input/);
  });

  it('turns a network failure into a TranscribeError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      transcribeAudio({ audioBase64: 'AAAA', format: 'wav', apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/could not reach OpenRouter: ECONNREFUSED/);
  });

  it('fails when the completion carries no usable content', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(
      transcribeAudio({ audioBase64: 'AAAA', format: 'wav', apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/no usable completion/);
  });

  // Silence is a legitimate outcome — the prompt asks for an empty string, and
  // the caller decides what to do with it. It must not be an error.
  it('allows an empty transcription', async () => {
    const fetchImpl = vi.fn(async () => okResponse(''));
    const result = await transcribeAudio({
      audioBase64: 'AAAA',
      format: 'wav',
      apiKey: 'k',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.text).toBe('');
  });
});
