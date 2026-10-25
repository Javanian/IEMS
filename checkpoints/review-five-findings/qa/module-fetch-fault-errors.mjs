const importFailure = /(?:Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module)/i;
const recoveryMessage = 'Portfolio workspace failed to load.';

function descriptions(args = []) {
  return args.flatMap(argument => [argument.value, argument.description]).filter(value => typeof value === 'string');
}

export function classifyModuleFaultErrors({ events, failures, consoleErrors, exceptions }) {
  const aborted = events.filter(event => event.kind === 'actual-module-aborted');
  if (aborted.length !== 1) throw Error('Expected exactly one recorded aborted module request');
  const fault = aborted[0], parsed = new URL(fault.url);
  if (parsed.pathname !== '/src/pages/PORTFOLIO/PortfolioPage.jsx' || !fault.networkId || !failures.some(row => row.requestId === fault.networkId && row.phase === 'intentional-module-fault')) throw Error('The recorded module abort must have matching actual network failure evidence');
  const attributable = (phase, text) => phase === 'intentional-module-fault' && text.includes(fault.url) && importFailure.test(text);
  const classifiedConsole = consoleErrors.map(row => {
    const parts = descriptions(row.args), text = parts.join('\n');
    return { expected: attributable(row.phase, text), recovery: parts[0] === recoveryMessage, phase: row.phase, text };
  });
  const classifiedExceptions = exceptions.map(row => {
    const details = row.exceptionDetails || {}, text = [details.text, ...descriptions([details.exception || {}])].filter(Boolean).join('\n');
    return { expected: attributable(row.phase, text), phase: row.phase, text };
  });
  return { abortedModuleUrl: fault.url, recoveryConsoleCount: classifiedConsole.filter(row => row.expected && row.recovery).length, expectedConsoleCount: classifiedConsole.filter(row => row.expected).length, expectedExceptionCount: classifiedExceptions.filter(row => row.expected).length, unrelatedConsole: classifiedConsole.filter(row => !row.expected), unrelatedExceptions: classifiedExceptions.filter(row => !row.expected) };
}
