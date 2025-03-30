export type TypeNavigation = {
    blockId: string;
    type: 'navigate-block-refresh' | 'navigate-block-back' | 'navigate-block-forward' | 'navigate-block-url' | 'navigate-block-none' | '';
    tabId: number;
    url?: string;
    variables?: Record<string, any>;
};