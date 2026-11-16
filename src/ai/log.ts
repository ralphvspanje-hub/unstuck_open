// Where the model code writes its one-line notes (timings, model names, token counts, errors; never
// a key, never a request body). The server sends them to its terminal and .logs/server.log; in the
// extension they go to the background worker's console.
let sink: (line: string) => void = (line) => console.log(line);

export function log(line: string) {
  sink(line);
}

export function setLog(fn: (line: string) => void) {
  sink = fn;
}
