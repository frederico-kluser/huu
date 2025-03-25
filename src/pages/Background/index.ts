import changeTabHandler from "./helpers/changeTabHandler";
import changeWindowHandler from "./helpers/changeWindowHandler";
import messageHandler from "./helpers/handlerMessage";

console.log('This is the background page.');
console.log('Put the background scripts here.');

changeTabHandler();
changeWindowHandler();
messageHandler();