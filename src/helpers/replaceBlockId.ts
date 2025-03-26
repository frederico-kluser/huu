interface BlocklyBlock {
    id?: string;
    type?: string;
    [key: string]: any;
}

interface BlocklyObject {
    blocks?: {
        languageVersion?: number;
        blocks?: BlocklyBlock[];
        [key: string]: any;
    };
    variables?: any[];
    [key: string]: any;
}

/**
 * Validates if an object is a valid Blockly block
 * 
 * @param block - The block to validate
 * @returns True if the block is valid, false otherwise
 */
const isValidBlock = (block: any): boolean => {
    if (!block || typeof block !== 'object') {
        return false;
    }

    // At minimum, a valid block should have a type property
    return Object.prototype.hasOwnProperty.call(block, 'type');
};

/**
 * Validates if an object is a valid Blockly object structure
 * 
 * @param obj - The object to validate
 * @returns True if the object has a valid Blockly structure, false otherwise
 */
const isValidBlocklyObject = (obj: any): boolean => {
    if (!obj || typeof obj !== 'object') {
        return false;
    }

    // Check if it has the 'blocks' property which is essential for Blockly objects
    if (!Object.prototype.hasOwnProperty.call(obj, 'blocks')) {
        return false;
    }

    // If blocks has a 'blocks' array, validate it
    const nestedBlocks = obj.blocks.blocks;
    if (nestedBlocks && Array.isArray(nestedBlocks)) {
        // Should have at least one block
        if (nestedBlocks.length === 0) {
            return false;
        }

        // Check a sample block
        return isValidBlock(nestedBlocks[0]);
    }

    return true;
};

/**
 * Replaces a block with a specific ID in a Blockly object with a new block.
 * 
 * @param blocklyObject - The Blockly object containing blocks
 * @param targetId - The ID of the block to replace
 * @param newBlock - The new block to insert
 * @returns A new Blockly object with the specified block replaced
 * @throws Error if inputs are invalid or block with specified ID is not found
 */
const replaceBlockById = (
    blocklyObject: any,
    targetId: string,
    newBlock: BlocklyBlock,
): BlocklyObject => {
    // Validate inputs
    if (!blocklyObject) {
        throw new Error('Blockly object is required');
    }

    if (!isValidBlocklyObject(blocklyObject)) {
        throw new Error('Invalid Blockly object structure');
    }

    if (!targetId || typeof targetId !== 'string') {
        throw new Error('Target ID must be a non-empty string');
    }

    if (!isValidBlock(newBlock)) {
        throw new Error('Invalid new block: block must be an object with at least a "type" property');
    }

    // Clone the object to avoid mutating the original
    const clonedObject = JSON.parse(JSON.stringify(blocklyObject));

    // Flag to track if we've found and replaced the block
    let blockReplaced = false;

    /**
     * Recursively traverses the object to find and replace the block
     */
    const findAndReplace = (obj: any): any => {
        // Not an object or null
        if (!obj || typeof obj !== 'object') {
            return obj;
        }

        // This is the block we're looking for
        if (obj.id === targetId) {
            blockReplaced = true;
            return { ...newBlock };
        }

        // Handle arrays
        if (Array.isArray(obj)) {
            return obj.map((item) => findAndReplace(item));
        }

        // Handle object properties
        const result: { [key: string]: any } = {};

        Object.keys(obj).forEach((key) => {
            result[key] = findAndReplace(obj[key]);
        });

        return result;
    };

    // Perform the search and replace
    const result = findAndReplace(clonedObject);

    // Verify that the block was replaced
    if (!blockReplaced) {
        throw new Error(`Block with ID "${targetId}" not found in the Blockly object`);
    }

    return result as BlocklyObject;
};

export default replaceBlockById;