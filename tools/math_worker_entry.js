import {render} from './math_entry.js';
WorkerScript.onMessage = function(message) {
  try { WorkerScript.sendMessage({token:message.token,result:render(message.latex)}); }
  catch (error) { console.warn('Formula:',error.stack);WorkerScript.sendMessage({token:message.token,error:String(error.message || error)}); }
};
