export type TypeNavigation = {
    blockId: string;
    type: 'refresh' | 'back' | 'forward' | 'url' | '';
    tabId: number;
    url?: string;
    variables?: Record<string, any>;
};