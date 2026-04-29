import { z } from 'zod';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RecentModelsSchema = z.object({
  recent: z.array(z.string()).max(5),
  favorites: z.array(z.string()).max(10),
});

export type RecentModels = z.infer<typeof RecentModelsSchema>;

const MAX_RECENT = 5;
const MAX_FAVORITES = 10;
const APP_DIR = '.huu';
const RECENTS_FILE = 'recents.json';

function recentsDir(): string {
  return join(homedir(), APP_DIR);
}

function recentsPath(): string {
  return join(recentsDir(), RECENTS_FILE);
}

function emptyRecents(): RecentModels {
  return { recent: [], favorites: [] };
}

export function loadRecents(): RecentModels {
  const filePath = recentsPath();
  if (!existsSync(filePath)) return emptyRecents();
  try {
    return RecentModelsSchema.parse(JSON.parse(readFileSync(filePath, 'utf-8')));
  } catch {
    return emptyRecents();
  }
}

export function saveRecents(recents: RecentModels): void {
  const dir = recentsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(recentsPath(), JSON.stringify(recents, null, 2), 'utf-8');
}

export function addRecent(modelId: string): void {
  const data = loadRecents();
  data.recent = [modelId, ...data.recent.filter((id) => id !== modelId)].slice(0, MAX_RECENT);
  saveRecents(data);
}

export function toggleFavorite(modelId: string): void {
  const data = loadRecents();
  const index = data.favorites.indexOf(modelId);
  if (index >= 0) {
    data.favorites.splice(index, 1);
  } else {
    data.favorites.push(modelId);
    if (data.favorites.length > MAX_FAVORITES) data.favorites.shift();
  }
  saveRecents(data);
}
