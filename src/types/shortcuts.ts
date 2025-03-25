type TypeHandleShortcut = {
    [key: string]: {
        removeListener: Array<() => void>;
        lastUpdate: number;
    };
};

export default TypeHandleShortcut;