/**
 * Find function blocks in initialBlocklyObject that match function calls in navigationBlocklyObject
 * 
 * @param navigationBlocklyObject - The object containing function calls
 * @param initialBlocklyObject - The object containing function definitions
 * @returns An array of function blocks that match the function calls
 */
const findFunctionReferences = (
    navigationBlocklyObject: any,
    initialBlocklyObject: any,
): any[] => {
    // Function to recursively find all objects with specific criteria
    const findObjects = (
        obj: any,
        predicate: (obj: any) => boolean,
        processed = new WeakSet(),
        results: any[] = [],
    ): any[] => {
        // Skip if not an object, null, or already processed
        if (!obj || typeof obj !== 'object' || processed.has(obj)) {
            return results;
        }

        // Mark as processed to avoid cycles
        processed.add(obj);

        // Check if current object matches predicate
        if (predicate(obj)) {
            results.push(obj);
        }

        // Recursively check all properties
        Object.keys(obj).forEach((key) => {
            findObjects(obj[key], predicate, processed, results);
        });

        return results;
    };

    // Array to store function names from navigationBlocklyObject
    const functionNames: string[] = [];

    // Step 1: Find all procedure calls in navigationBlocklyObject
    findObjects(
        navigationBlocklyObject,
        (obj) => obj.type === 'procedures_callnoreturn' &&
            obj.extraState && typeof obj.extraState.name === 'string',
    ).forEach((obj) => {
        functionNames.push(obj.extraState.name);
    });

    // Array to store matching function blocks from initialBlocklyObject
    const functionBlocks: any[] = [];
    const processedIds = new Set<string>();

    // Step 2: Find all procedure definitions in initialBlocklyObject that match function names
    findObjects(
        initialBlocklyObject,
        (obj) => obj.type === 'procedures_defnoreturn' &&
            obj.fields && typeof obj.fields.NAME === 'string' &&
            functionNames.includes(obj.fields.NAME),
    ).forEach((obj) => {
        // Avoid duplicates by checking ID
        if (obj.id && !processedIds.has(obj.id)) {
            processedIds.add(obj.id);
            functionBlocks.push(obj);
        }
    });

    return functionBlocks;
};

const injectNavigationFunctions = (result: any) => {
    const resultClone = JSON.parse(JSON.stringify(result));

    /*
      procedures_defnoreturn
      procedures_callnoreturn
    */
    console.log("resultClone.initial", resultClone.initial);
    console.log("resultClone.navigation", resultClone.navigation);

    Object.entries(resultClone.navigation).forEach(([key, value]: [string, any]) => {
        const cloneInitial = JSON.parse(JSON.stringify(resultClone.initial));

        const functionReferences = findFunctionReferences(value.block, cloneInitial);

        cloneInitial.blocks.blocks = [...functionReferences, value.block];
        resultClone.navigation[key] = cloneInitial;
    });

    return resultClone;
};

export default injectNavigationFunctions;