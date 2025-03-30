import * as Blockly from 'blockly/core';
import { RenderedWorkspaceComment } from 'blockly/core/comments';

interface Scope {
    block?: Blockly.BlockSvg;
    workspace?: Blockly.WorkspaceSvg;
    comment?: RenderedWorkspaceComment;
}
/*
  Registro de uma opção personalizada no menu de contexto para deletar blocos.

  Essa opção será exibida quando o usuário clicar com o botão direito
  sobre um bloco no workspace.
*/
const customDeleteOption = {
    // ID único para identificar a opção.
    id: 'customDeleteBlock',

    // Define o escopo da opção: aqui, somente blocos terão essa opção.
    scopeType: Blockly.ContextMenuRegistry.ScopeType.BLOCK,

    // Função que retorna o texto a ser exibido na opção do menu.
    // O parâmetro 'scope' contém informações sobre o bloco em que o menu foi ativado.
    displayText: (scope: any) => {
        // Exibe o tipo do bloco no texto (por exemplo, "Delete math_add block").
        return `Delete ${scope.block.type} block`;
    },

    // Define o peso da opção no menu de contexto.
    // Opções com peso maior são exibidas mais abaixo na lista.
    weight: 10,

    // Função que determina o estado da opção:
    // retorna 'enabled' se o bloco puder ser deletado, ou 'disabled' caso contrário.
    preconditionFn: (scope: Scope) => {
        if (scope.block?.isDeletable()) {
            return 'enabled';
        }
        return 'disabled';
    },

    // Callback executado quando o usuário seleciona a opção do menu.
    // Nesse caso, o bloco associado é removido do workspace.
    callback: (scope: any, e: PointerEvent) => {
        scope.block.dispose();
    },
};

const blocklyContextMenus = [
    customDeleteOption,
];

export default blocklyContextMenus;