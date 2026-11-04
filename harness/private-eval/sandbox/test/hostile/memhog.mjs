// Allocate and touch memory until something stops us.
const keep = [];
for (;;) keep.push(Buffer.alloc(16 << 20, 1));
