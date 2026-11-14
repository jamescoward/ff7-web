// #112: what is around the player in a field: talkable models and exits.
// Original project code, GPL-2.0-or-later. Pure functions over values the
// layer has already read (semantic/layer.js nearby()); no memory access, no
// DOM, no timers, so a native frontend can reuse them.
//
// The rules restate how the field module decides, as described by
// Xeeynamo/ff7-decomp@2c9239a4da08f039b1dcd4a3c9c34fe3fe7287fe
// src/field/field_entity.c (FieldEntityCheckTalk, FieldEntityDirByVec,
// FieldEntityGatewayCheck, FieldEntitySqrDistToLine). Reference only: no
// code is copied; this is an independent implementation of the stated
// conditions (notes/112-field-interactables.md).
//
// Units: field units, i.e. FieldEntity PosX/PosY/PosZ >> 12, the units the
// gateway lines and the talk and solid ranges are in.

/** gateways[i].fieldMapId of an unused gateway. */
export const GATEWAY_UNUSED = 0x7fff;
/** The game ignores models whose height differs from the player's by this much or more. */
export const TALK_Z_LIMIT = 256;
/** A model is talked to only if the player faces it within this many 1/256 turns. */
export const TALK_FACING_LIMIT = 64;

/** A field position (raw PosX/PosY/PosZ, s32) in field units: arithmetic >> 12. */
export const fieldUnits = (raw) => Math.floor(raw / 4096);

/**
 * The game's direction from (x0, y0) to (x1, y1), in 1/256 turns, in the
 * convention of FieldEntity.Dir: 64 more than the angle of the vector
 * measured from +x towards +y. The game uses a lookup table, so it may
 * differ from this by a step.
 */
export function directionTo(x0, y0, x1, y1) {
  const a = Math.round((Math.atan2(y1 - y0, x1 - x0) * 128) / Math.PI);
  return (((a + 64) % 256) + 256) % 256;
}

/** How far apart two 1/256-turn directions are: 0..128. */
export function turnDifference(a, b) {
  const d = (((a - b) % 256) + 256) % 256;
  return d > 128 ? 256 - d : d;
}

/**
 * Would a Circle press now talk to `model`? The game's conditions: the
 * model is not the player and its TalkOff is clear, it is not at the
 * player's exact x/y, its height is within TALK_Z_LIMIT, the distance on the
 * ground is less than its TalkRange plus the player's SolidRange, and the
 * player faces it within TALK_FACING_LIMIT. (When several qualify, the game
 * talks to the one faced most directly.) Returns { inRange, near, facing,
 * distance }: near is the distance and height part alone.
 */
export function talkCheck(player, model) {
  const dx = model.x - player.x;
  const dy = model.y - player.y;
  const dz = player.z - model.z;
  const distance = Math.floor(Math.hypot(dx, dy));
  const talkable = !model.talkOff && (dx !== 0 || dy !== 0);
  const near = talkable && dz > -TALK_Z_LIMIT && dz < TALK_Z_LIMIT && distance < model.talkRange + player.solidRange;
  const facing = talkable && turnDifference(player.dir, directionTo(player.x, player.y, model.x, model.y)) < TALK_FACING_LIMIT;
  return { inRange: near && facing, near, facing, distance };
}

/**
 * Squared distance from point p to the line segment of a gateway (3D, as
 * the game measures it), or null when the nearest point of the line is
 * beyond either end.
 */
export function lineDistanceSq(g, p) {
  const ex = g.x2 - g.x1;
  const ey = g.y2 - g.y1;
  const ez = g.z2 - g.z1;
  const len2 = ex * ex + ey * ey + ez * ez;
  if (len2 === 0) return null;
  const t = ((p.x - g.x1) * ex + (p.y - g.y1) * ey + (p.z - g.z1) * ez) / len2;
  if (t < 0 || t > 1) return null;
  const nx = g.x1 + t * ex - p.x;
  const ny = g.y1 + t * ey - p.y;
  const nz = g.z1 + t * ez - p.z;
  return nx * nx + ny * ny + nz * nz;
}

/**
 * The list nearby() reports, nearest first:
 *   { kind: 'npc', model, dx, dy, distance, inRange, near, facing } for every
 *     model other than the player whose TalkOff is clear;
 *   { kind: 'unknown', model, dx, dy, distance, inRange: false } for the other
 *     models (TalkOff set: objects, followers, hidden models);
 *   { kind: 'exit', gateway, to, dx, dy, distance, inRange } for every used
 *     gateway: dx/dy to the middle of its line, to = the field it leads to,
 *     inRange = the player is within its SolidRange of the line, where the
 *     game checks for a crossing.
 * 'save' is never reported yet: nothing read so far tells a save point from
 * another model (#112 follow-up). dx, dy: field units from the player.
 *
 * player: { x, y, z, dir, solidRange, model }, models: [{ x, y, z, talkOff,
 * talkRange }] indexed by model, gateways: [{ x1, y1, z1, x2, y2, z2, to }].
 */
export function nearbyFrom({ player, models, gateways }) {
  const out = [];
  models.forEach((m, i) => {
    if (i === player.model) return;
    const dx = m.x - player.x;
    const dy = m.y - player.y;
    if (m.talkOff) {
      out.push({ kind: 'unknown', model: i, dx, dy, distance: Math.floor(Math.hypot(dx, dy)), inRange: false });
      return;
    }
    const t = talkCheck(player, m);
    out.push({ kind: 'npc', model: i, dx, dy, distance: t.distance, inRange: t.inRange, near: t.near, facing: t.facing });
  });
  gateways.forEach((g, i) => {
    if (g.to === GATEWAY_UNUSED) return;
    const dx = Math.round((g.x1 + g.x2) / 2) - player.x;
    const dy = Math.round((g.y1 + g.y2) / 2) - player.y;
    const d2 = lineDistanceSq(g, player);
    out.push({ kind: 'exit', gateway: i, to: g.to, dx, dy, distance: Math.floor(Math.hypot(dx, dy)), inRange: d2 !== null && d2 < player.solidRange * player.solidRange });
  });
  return out.sort((a, b) => a.distance - b.distance);
}
