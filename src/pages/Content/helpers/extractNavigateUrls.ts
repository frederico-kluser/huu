import { TypeBlock } from "../../../types/agent";

interface BlocklyField {
    id?: string;
    TEXT?: string;
    [key: string]: any;
}

interface BlocklyBlock {
    type: string;
    id: string;
    fields?: {
        VAR?: BlocklyField;
        TEXT?: string;
        [key: string]: any;
    };
    inputs?: {
        URL?: {
            shadow?: {
                fields?: {
                    TEXT?: string;
                };
            };
            block?: BlocklyBlock;
        };
        VALUE?: {
            block?: BlocklyBlock;
        };
        [key: string]: any;
    };
    next?: {
        block?: BlocklyBlock;
    };
}

const extractNavigateUrls = (blocklyJson: TypeBlock): string[] => {
    const urls: string[] = [];
    const variables: Record<string, string> = {};

    // Helper function to collect variable values
    const collectVariables = (block: BlocklyBlock): void => {
        if (!block) return;

        if (block.type === 'variables_set' && block.fields?.VAR?.id) {
            const varId = block.fields.VAR.id;

            if (block.inputs?.VALUE?.block?.type === 'text' && block.inputs.VALUE.block.fields?.TEXT) {
                variables[varId] = block.inputs.VALUE.block.fields.TEXT;
            }
        }

        // Recursively process all inputs
        if (block.inputs) {
            Object.values(block.inputs).forEach(input => {
                if (input.block) {
                    collectVariables(input.block);
                }
            });
        }

        // Continue with next block if it exists
        if (block.next?.block) {
            collectVariables(block.next.block);
        }
    };

    // Helper function to recursively find all BlockNavigateToUrlText blocks
    const findNavigateBlocks = (block: BlocklyBlock): void => {
        if (!block) return;

        // Check if this is a navigation block
        if (block.type === 'BlockNavigateToUrlText') {
            if (block.inputs?.URL) {
                const urlInput = block.inputs.URL;

                // Case 1: Direct URL in block
                if (urlInput.block?.type === 'text' && urlInput.block.fields?.TEXT && !urls.includes(urlInput.block.fields.TEXT)) {
                    urls.push(urlInput.block.fields.TEXT);
                }
                // Case 2: URL from variable reference
                else if (urlInput.block?.type === 'variables_get' && urlInput.block.fields?.VAR?.id) {
                    const varId = urlInput.block.fields.VAR.id;
                    if (variables[varId] && !urls.includes(variables[varId])) {
                        urls.push(variables[varId]);
                    }
                }
                // Case 3: URL in shadow (fallback)
                else if (urlInput.shadow?.fields?.TEXT && !urls.includes(urlInput.shadow.fields.TEXT)) {
                    urls.push(urlInput.shadow.fields.TEXT);
                }
            }
        }

        // Recursively process all inputs
        if (block.inputs) {
            Object.values(block.inputs).forEach(input => {
                if (input.block) {
                    findNavigateBlocks(input.block);
                }
            });
        }

        // Continue with next block if it exists
        if (block.next?.block) {
            findNavigateBlocks(block.next.block);
        }
    };

    // First, collect all variable values by traversing the entire block structure
    blocklyJson.blocks.blocks.forEach((block: any) => {
        collectVariables(block);
    });

    // Then find all navigation blocks by traversing the entire structure
    blocklyJson.blocks.blocks.forEach((block: any) => {
        findNavigateBlocks(block);
    });

    return urls;
};

export default extractNavigateUrls;