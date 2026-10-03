/**
 * Vision side-call — the ONLY path a screenshot takes to a model that can see.
 *
 * WHY A SIDE-CALL AND NOT AN ATTACHMENT. Measured 2026-10-03 against the jcode
 * backend this project runs its agents on: `jcode run` takes the prompt in
 * argv and its `read` tool does NOT deliver image content to the model (a
 * vision model asked to read a PNG answered "NAO-VE-IMAGEM" — it saw only the
 * filename). So an image attached to a dev session would die before the model.
 * The side-call sends the image DIRECTLY to a vision-capable model (the
 * session's own model — the dev mode gates on image input), and the analysis
 * it returns enters the agent's context as text.
 *
 * THE DISCLOSURE IS NOT OPTIONAL. Every analysis this module returns is
 * wrapped to say which model saw the image and that it is a side-call. The
 * failure the research dossier documented without this (Cursor/Kimi K3) is a
 * caption pipeline whose existence the user never learns: the agent then
 * "hallucinates confidently" over a description it cannot distinguish from
 * its own perception. A wrapped analysis is second-hand SEEING, and the text
 * says so — never a silent substitution (opencode #29216: the same silence
 * blocks vision-tool delegation outright).
 *
 * Privacy boundary (PixelLeak, 2026-09): whatever reaches this module is
 * LEAVING for the provider. Callers must show the user what will be sent and
 * get an explicit act (choosing the file, picking the capture region) first;
 * this module never captures and never stores.
 */
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { HumanMessage } from '@langchain/core/messages';
import { buildChatClient, type LlmClientContext } from './llm-client-factory.js';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** A screenshot file as this module sees it: bytes + declared mime. */
export interface VisionImage {
  path: string;
  mimeType: string;
  /** Base64 payload — what travels as the `data:` URL. */
  base64: string;
}

export interface VisionSideCallOptions {
  /** Provider context (credential + endpoint) — same shape every helper uses. */
  ctx: LlmClientContext;
  /** The vision model to ask. The dev-mode gate guarantees it accepts images. */
  modelId: string;
  /** What to ask ABOUT the image(s). */
  prompt: string;
  /** Screenshot files on disk (PNG/JPEG/WebP/GIF). */
  imagePaths: readonly string[];
  maxTokens?: number;
  /**
   * Injection seam for tests: anything with the `invoke([message])` shape the
   * LangChain client exposes. Omitted → `buildChatClient` builds the real one.
   */
  client?: { invoke(messages: unknown[]): Promise<unknown> };
}

export interface VisionAnalysis {
  model: string;
  /** How many images the model actually saw. */
  images: number;
  /** File names, for the disclosure line. */
  names: readonly string[];
  /** The model's raw analysis text. */
  raw: string;
  /**
   * THE analysis as it may enter an agent's context: raw text inside a
   * mandatory disclosure header. Use THIS one; `raw` exists for tests and
   * for callers that build their own header once for several calls.
   */
  disclosed: string;
}

/** Load image files into side-call payloads. Throws on unreadable/unknown types. */
export function loadVisionImages(paths: readonly string[]): VisionImage[] {
  return paths.map((path) => {
    const mimeType = MIME_BY_EXT[extname(path).toLowerCase()];
    if (!mimeType) {
      throw new Error(
        `vision: formato de imagem não suportado em ${path} — use PNG, JPEG, WebP ou GIF.`,
      );
    }
    return { path, mimeType, base64: readFileSync(path).toString('base64') };
  });
}

/**
 * The multimodal message — pure, so the wire shape is unit-testable without a
 * network or a key. One text part with the question, then one `image_url`
 * data-URL part per image (the OpenAI-compatible content-parts shape, which
 * is what openrouter.ai accepts).
 */
export function buildVisionMessage(
  prompt: string,
  images: readonly VisionImage[],
): HumanMessage {
  return new HumanMessage({
    content: [
      { type: 'text', text: prompt },
      ...images.map((img) => ({
        type: 'image_url' as const,
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
      })),
    ],
  });
}

/** The disclosure header every analysis travels under. */
export function visionDisclosure(model: string, names: readonly string[]): string {
  const list = names.map((n) => basename(n)).join(', ');
  return `[visão via ${model} · side-call sobre ${names.length} imagem(ns): ${list} — descrição de segundo grau, não percepção direta do agente]`;
}

/** Extract the text out of whatever the client returned. */
function textFromResponse(response: unknown): string {
  const anyRes = response as { content?: unknown };
  const content = anyRes?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : ((part as { text?: string }).text ?? '')))
      .join('\n')
      .trim();
  }
  return '';
}

/**
 * Ask the vision model about the images and return the DISCLOSED analysis.
 * Throws only for local problems (unreadable file, unsupported format, empty
 * model id); a provider failure surfaces as an empty analysis the caller must
 * report — never as a silent drop.
 */
export async function analyzeImages(opts: VisionSideCallOptions): Promise<VisionAnalysis> {
  const modelId = opts.modelId.trim();
  if (!modelId) throw new Error('vision: modelId vazio — o side-call precisa de um modelo com visão.');

  const images = loadVisionImages(opts.imagePaths);
  const message = buildVisionMessage(opts.prompt, images);
  const client =
    opts.client ??
    buildChatClient(opts.ctx, {
      modelId,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    });

  const response = await client.invoke([message]);
  const raw = textFromResponse(response);
  const names = images.map((img) => img.path);

  return {
    model: modelId,
    images: images.length,
    names,
    raw,
    disclosed: `${visionDisclosure(modelId, names)} ${raw}`.trim(),
  };
}
