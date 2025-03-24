import Blockly from 'blockly';
import { javascriptGenerator } from 'blockly/javascript';

function generateCodeFromBlocks(blocksJson: any): string {
    // Cria um workspace headless (sem renderização na tela)
    const headlessWorkspace = new Blockly.Workspace();

    // Carrega os blocos no workspace headless
    Blockly.serialization.workspaces.load(blocksJson, headlessWorkspace);

    // Gera o código
    const code = javascriptGenerator.workspaceToCode(headlessWorkspace);

    // Limpa o workspace para evitar vazamento de memória
    headlessWorkspace.dispose();

    return code;
}

export default generateCodeFromBlocks;