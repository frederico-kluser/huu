import getTabAgents from '../../core/getTabAgents';
import { messageListener } from '../../core/message';

console.log('Content script works!');

getTabAgents(window.location.href).then((agents) => {
    console.log('agents:', agents);
});

// TODO: vou ter que ter um listner para as mudanças de agent e saber quando remover ou inserir um código, com base nele esta ativado ou desativado, e cuidado para duante a execução do codigo, não removelo e causar um side effect

messageListener.content();