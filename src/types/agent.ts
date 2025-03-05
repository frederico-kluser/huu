export type TypeMode =
    | ''
    | 'automatic-1'
    | 'automatic'
    | 'manual-shortcut-2'
    | 'manual-shortcut-3'
    | 'manual-shortcut-4'
    | 'manual-shortcut-5'
    | 'manual-shortcut-6'
    | 'manual-shortcut-7'
    | 'manual-shortcut-8'
    | 'manual-shortcut-9'

export type TypeBlock = {
    [key: string]: any;
};

type TypeAgent = {
    name: string;
    blocks: TypeBlock;
    urls: string;
    code: string;
    mode: TypeMode;
    active: boolean;
    lastUpdate: number;
};

export default TypeAgent;