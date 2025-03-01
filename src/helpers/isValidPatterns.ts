function isValidUrlPattern(pattern: string): boolean {
    // Verifica se o padrão não é vazio e não contém espaços em branco
    if (!pattern || pattern.trim() === '' || /\s/.test(pattern)) {
        return false;
    }

    // O padrão deve conter pelo menos uma barra para separar domínio e caminho
    const slashIndex = pattern.indexOf('/');
    if (slashIndex === -1) {
        return false;
    }

    // Extrai a parte do domínio (antes da primeira barra)
    const domain = pattern.substring(0, slashIndex);
    if (!domain) return false;

    // Se o domínio iniciar com "*.", remove essa parte para validação
    const normalizedDomain = domain.startsWith('*.') ? domain.substring(2) : domain;

    // Verifica se o domínio (ou parte dele) possui pelo menos um ponto
    if (!normalizedDomain.includes('.')) {
        return false;
    }

    // A parte do caminho (após a barra) pode ser qualquer coisa
    return true;
}

function isValidPatterns(patterns: string): boolean {
    if (!patterns || patterns.trim() === '') {
        return false;
    }

    // Separa os padrões pela vírgula e valida cada um individualmente
    const patternList = patterns.split(',').map(p => p.trim());
    return patternList.every(pattern => isValidUrlPattern(pattern));
}

export default isValidPatterns;
