/**
 * The search library's native code logs the time of every model call through `console.log`
 * ("Execution of method 'forward' took 3 ms"), which buried the app's own logs. It logs from a
 * worklet runtime, whose console forwards to a copy of `console.log` taken when react-native-worklets
 * loads, so this filter has to be in place before anything else is imported (see `index.ts`).
 */
const log = console.log;
console.log = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith("Execution of method '")) return;
  log(...args);
};
