/**
 * Validates if the provided data matches the TypeAgent interface
 * @param {unknown} data - The data to validate
 * @returns {Object} Result containing isValid flag and any validation errors
 */
export const validateTypeAgent = (data: unknown): { isValid: boolean; errors: string[] } => {
    const errors: string[] = [];

    // Check if data is an object
    if (typeof data !== 'object' || data === null) {
        return { isValid: false, errors: ['Input must be an object'] };
    }

    const agent = data as Record<string, unknown>;

    // Validate required fields existence
    const requiredFields = [
        'name',
        'blocks',
        'code',
        'navigation',
        'urls',
        'mode',
        'active',
        'lastUpdate',
        'agentVersion',
    ];

    requiredFields.forEach((field) => {
        if (agent[field] === undefined) {
            errors.push(`${field} is required`);
        }
    });

    // If missing required fields, no need to validate further
    if (errors.length > 0) {
        return { isValid: false, errors };
    }

    // Validate name (string and required)
    if (typeof agent.name !== 'string') {
        errors.push('name must be a string');
    } else if (agent.name.trim() === '') {
        errors.push('name cannot be empty');
    }

    // Validate blocks (object and required)
    if (typeof agent.blocks !== 'object' || agent.blocks === null) {
        errors.push('blocks must be an object');
    }

    // Validate code (string and required)
    if (typeof agent.code !== 'string') {
        errors.push('code must be a string');
    }

    // Validate navigation (object and required)
    if (typeof agent.navigation !== 'object' || agent.navigation === null) {
        errors.push('navigation must be an object');
    }

    // Validate urls (string and required)
    if (typeof agent.urls !== 'string') {
        errors.push('urls must be a string');
    }

    // Validate mode (TypeMode and required)
    const validModes = [
        '',
        'automatic-1',
        'automatic',
        'manual-shortcut-2',
        'manual-shortcut-3',
        'manual-shortcut-4',
        'manual-shortcut-5',
        'manual-shortcut-6',
        'manual-shortcut-7',
        'manual-shortcut-8',
        'manual-shortcut-9',
    ];

    if (typeof agent.mode !== 'string') {
        errors.push('mode must be a string');
    } else if (!validModes.includes(agent.mode as string)) {
        errors.push(`mode must be one of: ${validModes.join(', ')}`);
    }

    // Validate active (boolean and required)
    if (typeof agent.active !== 'boolean') {
        errors.push('active must be a boolean');
    }

    // Validate lastUpdate (number and required)
    if (typeof agent.lastUpdate !== 'number') {
        errors.push('lastUpdate must be a number');
    }

    // Validate actualCode (optional, string with specific values)
    if (agent.actualCode !== undefined) {
        if (agent.actualCode !== 'initial' && typeof agent.actualCode !== 'string') {
            errors.push('actualCode must be "initial" or a string');
        }
    }

    // Validate viewportState (optional, object with specific properties)
    if (agent.viewportState !== undefined) {
        if (typeof agent.viewportState !== 'object' || agent.viewportState === null) {
            errors.push('viewportState must be an object');
        } else {
            const viewport = agent.viewportState as Record<string, unknown>;

            if (typeof viewport.scale !== 'number') {
                errors.push('viewportState.scale must be a number');
            }

            if (typeof viewport.scrollX !== 'number') {
                errors.push('viewportState.scrollX must be a number');
            }

            if (typeof viewport.scrollY !== 'number') {
                errors.push('viewportState.scrollY must be a number');
            }
        }
    }

    // Validate agentVersion (string and required)
    if (typeof agent.agentVersion !== 'string') {
        errors.push('agentVersion must be a string');
    }

    return {
        isValid: errors.length === 0,
        errors,
    };
};