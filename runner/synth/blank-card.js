// Builds a formatted, blank 128 KiB PS1 memory card image in code. Original
// project code (GPL-2.0-or-later); the layout is the public memory card
// format (frame 0 header "MC", 15 directory frames, 20 broken-sector frames,
// each frame 128 bytes ending in an XOR checksum). It is never derived from a
// real save.

export const CARD_SIZE = 131072;
export const FRAME_SIZE = 128;

/** XOR of the first 127 bytes of a frame, written to its last byte. */
export function sealFrame(card, index) {
  const off = index * FRAME_SIZE;
  let x = 0;
  for (let i = 0; i < FRAME_SIZE - 1; i++) x ^= card[off + i];
  card[off + FRAME_SIZE - 1] = x;
}

export function blankCard() {
  const card = new Uint8Array(CARD_SIZE);
  card[0] = 0x4d; // 'M'
  card[1] = 0x43; // 'C'
  sealFrame(card, 0);
  for (let f = 1; f <= 15; f++) {
    // directory entry: free block, no next link
    const o = f * FRAME_SIZE;
    card[o] = 0xa0;
    card[o + 8] = 0xff;
    card[o + 9] = 0xff;
    sealFrame(card, f);
  }
  for (let f = 16; f <= 35; f++) {
    // broken sector list: none
    const o = f * FRAME_SIZE;
    card.fill(0xff, o, o + 4);
    card[o + 8] = 0xff;
    card[o + 9] = 0xff;
    sealFrame(card, f);
  }
  return card;
}
