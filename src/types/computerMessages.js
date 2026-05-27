'use strict';

const VALID_TYPES = new Set(['turtle', 'player', 'minecart', 'stationary']);

function isFiniteNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function isInt(v) {
  return isFiniteNum(v) && Number.isInteger(v);
}

function isValidLoc(v) {
  if (Array.isArray(v) && v.length >= 3) {
    return isFiniteNum(v[0]) && isFiniteNum(v[1]) && isFiniteNum(v[2]);
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
  }
  return false;
}

/**
 * Strips req.body down to only the fields that ComputerCraft computers are
 * allowed to set. Unknown keys are silently dropped. Invalid values for known
 * keys are dropped rather than rejecting the whole request.
 *
 * @param {object} body
 * @returns {object}
 */
function filterStateUpdate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};

  const out = {};

  if (typeof body.label === 'string' && body.label.length <= 100) {
    out.label = body.label;
  }

  if (body.loc !== undefined && isValidLoc(body.loc)) {
    out.loc = body.loc;
  }

  if (typeof body.rot === 'string' && body.rot.length <= 16) {
    out.rot = body.rot;
  }

  if (isInt(body.fuelLevel) && body.fuelLevel >= 0) {
    out.fuelLevel = body.fuelLevel;
  }

  if (isInt(body.fuelLimit) && body.fuelLimit >= 0) {
    out.fuelLimit = body.fuelLimit;
  }

  if (isInt(body.selectedSlot) && body.selectedSlot >= 1 && body.selectedSlot <= 16) {
    out.selectedSlot = body.selectedSlot;
  }

  if (typeof body.type === 'string' && VALID_TYPES.has(body.type)) {
    out.type = body.type;
  }

  if (Array.isArray(body.inv) && body.inv.length <= 64) { // turtles have 16 slots
    out.inv = body.inv;
  }

  if (typeof body.playerName === 'string' && body.playerName.length <= 100) {
    out.playerName = body.playerName;
  }

  if (isFiniteNum(body.yaw)) {
    out.yaw = body.yaw;
  }

  if (isFiniteNum(body.pitch)) {
    out.pitch = body.pitch;
  }

  if (isFiniteNum(body.health)) {
    out.health = body.health;
  }

  if (isFiniteNum(body.maxHealth)) {
    out.maxHealth = body.maxHealth;
  }

  if (isFiniteNum(body.foodLevel)) {
    out.foodLevel = body.foodLevel;
  }

  return out;
}

module.exports = { filterStateUpdate };
