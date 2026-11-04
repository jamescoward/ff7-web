// Entry point for `node --test tools/preview` (Node 22 resolves a directory
// argument as a module via package.json "main"). The glob form
// `node --test 'tools/preview/**/*.test.js'` runs the same tests.
import './preview.test.js';
import './gh-pages.test.js';
