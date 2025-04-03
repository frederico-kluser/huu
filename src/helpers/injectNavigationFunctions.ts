/**
 * Find function blocks in initialBlocklyObject that match function calls in navigationBlocklyObject
 * Performs recursive analysis of function dependencies to ensure all required functions are included.
 * 
 * @param navigationBlocklyObject - The object containing function calls
 * @param initialBlocklyObject - The object containing function definitions
 * @returns An array of function blocks that match the function calls and their dependencies
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

    // Set to store function names to process (avoid duplicates)
    const functionNamesToProcess = new Set<string>();
    // Set to store already processed function names
    const processedFunctionNames = new Set<string>();
    // Array to store matching function blocks from initialBlocklyObject
    const functionBlocks: any[] = [];
    const processedIds = new Set<string>();

    // Step 1: Find initial procedure calls in navigationBlocklyObject
    findObjects(
        navigationBlocklyObject,
        (obj) => obj.type === 'procedures_callnoreturn' &&
            obj.extraState && typeof obj.extraState.name === 'string',
    ).forEach((obj) => {
        functionNamesToProcess.add(obj.extraState.name);
    });

    // Function to get function definition by name
    const getFunctionDefinitionByName = (name: string): any | null => {
        const definitions = findObjects(
            initialBlocklyObject,
            (obj) => obj.type === 'procedures_defnoreturn' &&
                obj.fields && typeof obj.fields.NAME === 'string' &&
                obj.fields.NAME === name
        );
        return definitions.length > 0 ? definitions[0] : null;
    };

    // Step 2: Recursively process all function dependencies
    while (functionNamesToProcess.size > 0) {
        // Get next function to process
        const functionName = Array.from(functionNamesToProcess)[0];
        functionNamesToProcess.delete(functionName);
        
        // Skip if already processed
        if (processedFunctionNames.has(functionName)) {
            continue;
        }
        
        // Mark as processed
        processedFunctionNames.add(functionName);
        
        // Get function definition
        const functionDef = getFunctionDefinitionByName(functionName);
        if (!functionDef || (functionDef.id && processedIds.has(functionDef.id))) {
            continue;
        }
        
        // Add to results
        if (functionDef.id) {
            processedIds.add(functionDef.id);
            functionBlocks.push(functionDef);
        }
        
        // Find nested function calls within this function definition
        findObjects(
            functionDef,
            (obj) => obj.type === 'procedures_callnoreturn' &&
                obj.extraState && typeof obj.extraState.name === 'string',
        ).forEach((obj) => {
            // Add to queue if not processed yet
            if (!processedFunctionNames.has(obj.extraState.name)) {
                functionNamesToProcess.add(obj.extraState.name);
            }
        });
    }

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