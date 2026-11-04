// Entry point for `node --test tools/asset-guard`: Node 22 resolves a
// directory argument as a module (package.json "main"), not as a test
// folder, so this imports every test file. The glob form
// `node --test 'tools/asset-guard/**/*.test.js'` runs the same tests.
import './guard.test.js';
