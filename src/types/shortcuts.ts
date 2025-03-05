type TypeHandlerShortcut = {
    [key: string]: {
        removeListener: Array<() => void>;
        lastUpdate: number;
    };
};

export default TypeHandlerShortcut;