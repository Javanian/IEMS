import{boundedTransaction,contentHash}from'../tenant-foundation/commands.mjs';
export async function effectTransaction(client,fn){for(let attempt=0;attempt<5;attempt++){try{return await boundedTransaction(client,fn,{attempts:1});}catch(error){if(!(error.hasErrorLabel?.('TransientTransactionError')||error.errorLabels?.includes('TransientTransactionError'))||attempt===4)throw error;await new Promise(resolve=>setTimeout(resolve,5*(attempt+1)));}}}
export const effectHash=value=>contentHash({json:JSON.stringify(value)});
