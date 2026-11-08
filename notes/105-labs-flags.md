# Labs flags (#105)

`web/js/labs.js` holds off-by-default feature flags, so a touch feature that still needs the owner's iPhone check can merge without changing the default page.

Register a flag and gate on it:

```js
import { registerFlag, isOn, onChange } from './labs.js';
registerFlag('my-feature', { label: 'My feature', description: 'One line on what it does.' });
if (isOn('my-feature')) { /* new behaviour */ }
onChange((name, on) => { /* react to a toggle */ });
```

- A flag is on when switched on in the Labs panel (stored in `localStorage` key `ff7web.labs`) or named in `?labs=a,b` (this visit only, never stored; the panel shows "(this visit)"). Unknown names are ignored. Toggling in the panel persists and overrides the URL for that visit.
- `labs-demo` is a built-in flag that does nothing; tests use it.
- The module is `window.ff7web.labs`. In Tier 1 tests: load `server.url + '?labs=my-feature'` for flag-on, and the plain URL for flag-off (the default must equal `main`'s behaviour). Register flags at module load, before `createLabsPanel` renders.
- The Labs button sits in the top bar; the panel keeps clear of the pad (`web/test/labs.test.js`).
