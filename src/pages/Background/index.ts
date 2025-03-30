import agentGarbageHandler from "./helpers/agentGarbageHandler";
import changeTabHandler from "./helpers/changeTabHandler";
import changeWindowHandler from "./helpers/changeWindowHandler";
import messageHandler from "./helpers/messageHandler";

console.log('This is the background page.');
console.log('Put the background scripts here.');
agentGarbageHandler();

// listeners
changeTabHandler();
changeWindowHandler();
messageHandler();