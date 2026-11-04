// Never exit, and ignore polite signals.
process.on('SIGTERM', () => {});
process.on('SIGINT', () => {});
setInterval(() => {}, 1 << 30);
