#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function bumpVersion(current: string, type: 'patch' | 'minor' | 'major'): string {
  const [x, y, z] = current.split('.').map(Number);
  if (type === 'major') return `${x + 1}.0.0`;
  if (type === 'minor') return `${x}.${y + 1}.0`;
  return `${x}.${y}.${z + 1}`;
}

async function main() {
  // ── Pré-verificações ──────────────────────────────────────
  console.log('🔍 Verificando pré-condições...\n');

  // working tree limpo?
  try {
    execSync('git diff --quiet --exit-code', { stdio: 'ignore' });
    execSync('git diff --cached --quiet --exit-code', { stdio: 'ignore' });
  } catch {
    console.error('❌ Working tree não está limpo. Faça commit ou stash antes de fazer deploy.');
    process.exit(1);
  }

  // está em main/master?
  const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  if (branch !== 'main' && branch !== 'master') {
    console.error(`❌ Você está no branch "${branch}". Mude para main (ou master) antes de fazer deploy.`);
    process.exit(1);
  }

  // remote acessível?
  try {
    execSync('git fetch origin main --dry-run', { stdio: 'ignore' });
  } catch {
    console.log('⚠️  Não foi possível verificar se o remote está sincronizado. Continuando mesmo assim...\n');
  }

  // ── Pergunta o bump ───────────────────────────────────────
  const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
  const currentVersion = pkg.version;

  console.log(`📦 Versão atual: ${currentVersion}\n`);
  console.log('Escolha o tipo de bump SemVer:');
  console.log('  1) patch — correções de bugs, não-breaking');
  console.log('  2) minor — novos recursos (em 0.x.x, breaking changes vão em minor)');
  console.log('  3) major — breaking changes em 1.0.0+, ou primeira release estável');

  const choice = (await ask('\nOpção (1/2/3): ')).trim().toLowerCase();

  let bumpType: 'patch' | 'minor' | 'major';
  if (choice === '1' || choice === 'patch') bumpType = 'patch';
  else if (choice === '2' || choice === 'minor') bumpType = 'minor';
  else if (choice === '3' || choice === 'major') bumpType = 'major';
  else {
    console.log('❌ Opção inválida.');
    rl.close();
    process.exit(1);
  }

  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\n📦 Nova versão será: ${newVersion}`);
  const confirm = (await ask('Confirmar deploy? [Y/n]: ')).trim();
  if (confirm.toLowerCase() === 'n') {
    console.log('❌ Cancelado.');
    rl.close();
    process.exit(0);
  }

  // tag já existe?
  try {
    execSync(`git rev-parse v${newVersion}`, { stdio: 'ignore' });
    console.error(`❌ Tag v${newVersion} já existe localmente.`);
    rl.close();
    process.exit(1);
  } catch {
    // tag não existe, ótimo
  }

  try {
    // ── Atualiza arquivos ──────────────────────────────────
    pkg.version = newVersion;
    writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    console.log('✅ package.json atualizado');

    updateChangelog(newVersion);
    console.log('✅ CHANGELOG.md atualizado');

    // ── Validações ───────────────────────────────────────────
    console.log('\n🔧 Rodando typecheck...');
    execSync('npm run typecheck', { stdio: 'inherit' });

    console.log('\n🧪 Rodando testes...');
    execSync('npm test', { stdio: 'inherit' });

    console.log('\n🏗️  Rodando build...');
    execSync('npm run build', { stdio: 'inherit' });

    // ── Git: commit, tag, push ─────────────────────────────
    console.log('\n🔀 Fazendo commit, tag e push...');
    execSync('git add package.json CHANGELOG.md', { stdio: 'inherit' });
    execSync(`git commit -m "chore(release): v${newVersion}"`, { stdio: 'inherit' });
    execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
    execSync('git push origin main', { stdio: 'inherit' });
    execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });

    // ── Publica no npm ─────────────────────────────────────
    console.log('\n📤 Publicando no npm...');
    execSync('npm publish', { stdio: 'inherit' });

    console.log(`\n✅ Deploy v${newVersion} concluído com sucesso!`);

    // ── Opcional: Docker ───────────────────────────────────
    const dockerChoice = (await ask('\nDeseja também buildar e pushar a imagem Docker? [y/N]: ')).trim();
    if (dockerChoice.toLowerCase() === 'y') {
      console.log('\n🐳 Build multi-arch e push Docker...');
      const [major, minor] = newVersion.split('.');
      try {
        execSync(
          'docker buildx build ' +
            `--platform linux/amd64,linux/arm64 ` +
            `--tag ghcr.io/frederico-kluser/huu:${newVersion} ` +
            `--tag ghcr.io/frederico-kluser/huu:${major}.${minor} ` +
            `--tag ghcr.io/frederico-kluser/huu:${major} ` +
            `--tag ghcr.io/frederico-kluser/huu:latest ` +
            '--push .',
          { stdio: 'inherit' }
        );
        console.log('✅ Imagem Docker publicada!');
      } catch {
        console.log('❌ Falha no build/push Docker. Verifique se docker buildx e login ghcr.io estão OK.');
      }
    }
  } catch (err: any) {
    console.error('\n❌ Erro durante o deploy:', err.message || err);
    console.log('💡 Dica: se os arquivos foram modificados (package.json/CHANGELOG.md), restaure com:');
    console.log('   git checkout -- package.json CHANGELOG.md');
    process.exit(1);
  } finally {
    rl.close();
  }
}

function updateChangelog(version: string) {
  let text = readFileSync('./CHANGELOG.md', 'utf8');
  const today = new Date().toISOString().split('T')[0];

  // Extrai conteúdo da seção [Unreleased]
  const unreleasedRe = /(## \[Unreleased\]\n\n)([\s\S]*?)(?=\n## \[|$)/;
  const match = text.match(unreleasedRe);
  if (!match) {
    throw new Error('Não encontrou a seção [Unreleased] no CHANGELOG.md');
  }

  const unreleasedBody = match[2].trim();
  if (!unreleasedBody) {
    throw new Error('Seção [Unreleased] está vazia. Adicione entradas antes de fazer deploy.');
  }

  // Substitui: [Unreleased] fica vazia, conteúdo vai para nova seção
  const newSection = `## [Unreleased]\n\n## [${version}] - ${today}\n\n${unreleasedBody}\n`;
  text = text.replace(match[0], newSection);

  // ── Atualiza os links de comparação ─────────────────────
  const lines = text.split('\n');
  const linkLines: string[] = [];
  const otherLines: string[] = [];

  for (const line of lines) {
    if (/^\[.+\]:/.test(line)) linkLines.push(line);
    else otherLines.push(line);
  }

  // Atualiza link [Unreleased]
  const updatedLinks = linkLines.map((line) => {
    const m = line.match(/(.+)\/compare\/v[\d.]+\.\.\.HEAD/);
    if (m && line.startsWith('[Unreleased]:')) return `${m[1]}/compare/v${version}...HEAD`;
    return line;
  });

  // Insere novo link de release logo após [Unreleased]
  const unreleasedIdx = updatedLinks.findIndex((l) => l.startsWith('[Unreleased]:'));
  if (unreleasedIdx !== -1) {
    const newLink = `[${version}]: https://github.com/frederico-kluser/huu/releases/tag/v${version}`;
    updatedLinks.splice(unreleasedIdx + 1, 0, newLink);
  }

  text = otherLines.join('\n') + '\n' + updatedLinks.join('\n') + '\n';
  writeFileSync('./CHANGELOG.md', text);
}

main();
