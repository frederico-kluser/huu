export type TypeNavigation = {
    blockId: string;
    type: 'refresh' | 'back' | 'forward' | 'url' | 'none' | '';
    tabId: number;
    url?: string;
    variables?: Record<string, any>;
};