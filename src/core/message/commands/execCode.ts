import TypeChannelObjectFunction from "../../../types/channelOBjectFunction";
import CommunicationChannel from "../../../types/communicationChannel";

/*
Exec Code Passos:

Cadastro
    - Background verifica se o site está na lista de algum agente: se sim continua o processo abaixo
    - Background verifica se tem algum shortcut cadastrado para o site:
        - Sim: enviar o código e o shortcut para cadastrar no content script (apenas uma vez)
    - Background verifica se tem algum acionamento automático cadastrado para o site:
        - Sim: enviar o código para cadastrar no content script (apenas uma vez)
Acionamentos
    - Shortcut
        - Verifica se já está em execução
            - Sim: Informa que já está em execução
            - Não: 
                - content script cria um UUID para a execução e guarda até o final da execução
                - content script avisa o background que está em execução passando o UUID
                - background salva no storage: nome do shortcut, UUID, código fonte, site, status (executando, finalizado, erro) [erro porque coloco dentro de um try catch o eval]
                - content script executa o código
                - background avisa o popup que está em execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções
                - content script avisa o background que terminou a execução passando o UUID
                - background atualiza o storage com o status da execução
                - background avisa o popup que terminou a execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções
    - Automático:
        - Verifica se já está em execução
            - Sim: Informa que já está em execução
            - Não: 
                - content script cria um UUID para a execução e guarda até o final da execução
                - content script avisa o background que está em execução passando o UUID
                - background salva no storage: nome do acionamento automático, UUID, código fonte, site, status (executando, finalizado, erro) [erro porque coloco dentro de um try catch o eval]
                - content script executa o código
                - background avisa o popup que está em execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções
                - content script avisa o background que terminou a execução passando o UUID
                - background atualiza o storage com o status da execução
                - background avisa o popup que terminou a execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções
                - executa tudo de novo
    - Manual:
        - Verifica se já está em execução
            - Sim: Informa que já está em execução
            - Não:
                - popup manda o pedido para o background
                - background cria um UUID para a execução e guarda até o final da execução
                - background salva no storage: nome do acionamento manual, UUID, código fonte, site, status (executando, finalizado, erro) [erro porque coloco dentro de um try catch o eval]
                - background manda o pedido para o content script
                - content script executa o código
                - background avisa o popup que está em execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções
                - content script avisa o background que terminou a execução passando o UUID
                - background atualiza o storage com o status da execução
                - background avisa o popup que terminou a execução passando o UUID
                - se o popup estiver aberto: atualiza a lista de execuções 
        

*/

const execCode: TypeChannelObjectFunction = {
    [CommunicationChannel.BACKGROUND]: () => { },
    [CommunicationChannel.CONTENT]: () => { },
    [CommunicationChannel.POPUP]: () => { },
};

export default execCode;