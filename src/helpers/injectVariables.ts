function toJsLiteral(value: unknown): string {
    if (typeof value === 'string') return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null) return 'null';

    if (typeof value === 'object') {
        if (Array.isArray(value)) {
            return value.length === 0
                ? '[]'
                : `JSON.parse('${JSON.stringify(value).replace(/'/g, "\\'")}')`;
        }

        if (Object.keys(value).length === 0) return '{}';
        return `JSON.parse('${JSON.stringify(value).replace(/'/g, "\\'")}')`;
    }

    throw new Error(`Tipo de valor não suportado: ${typeof value}`);
}

function injectStringCodeVariables(variablesObj: Record<string, unknown>, code: string): string {
    const lines = code.split('\n');
    if (lines.length === 0) return code;

    const firstLine = lines[0].trim();

    // Extrai variáveis da primeira linha
    const varsMatch = firstLine.match(/^var\s+(.+?);$/);
    if (!varsMatch) return code; // Formato inválido

    const variables = varsMatch[1]
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);

    // Gera as atribuições
    const assignments = variables.map(varName => {
        if (!(varName in variablesObj)) return varName;

        const value = variablesObj[varName];
        return `${varName} = ${toJsLiteral(value)}`;
    });

    // Reconstroi a primeira linha
    lines[0] = `var ${assignments.join(', ')};`;

    return lines.join('\n');
}

export default injectStringCodeVariables;