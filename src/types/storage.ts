export type TypeNavigation = {
    blockId: number;
    type: 'refresh' | 'back' | 'forward' | 'url' | '';
    tabId: number;
    url?: string;
    variables?: Record<string, any>;
};