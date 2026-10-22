// The answer to a group's word, carried home by its envoy (envoys.js). While you answer a card their envoy brought, what
// your answer does to *their* side waits for the envoy to get home: coalition.js remember and noteAnswer, factions.js
// changeGoodwill on that group (sink.fid), and the parties it sends out (envoys.js holds them). sink.inPerson: you are
// talking face to face, so radio.js refusal does not ask for a radio link. Imports nothing (every module may read it).
//
// sink: { calls: [], goods: {}, from: {} | null, fid: number | null, inPerson: boolean }
let SINK = null;
export const talkSink = () => SINK;
export const inPerson = () => !!(SINK && SINK.inPerson);
export function withTalk(sink, fn) {
  const was = SINK;
  SINK = sink;
  try { return fn(); } finally { SINK = was; }
}
