// Custom GPS capture + realtime timing layer for the phone-as-datalogger.
// Pure data model/derivation (gpsFix), the stateful source (customGps), the
// sample bridge (observationSample), the session gate, the realtime lap timer,
// and the `.dovep` log writer. No UI or persistence lives here.

export * from './gpsFix';
export * from './customGps';
export * from './observationSample';
export * from './sessionGate';
export * from './realtimeTimer';
export * from './dovepWriter';
