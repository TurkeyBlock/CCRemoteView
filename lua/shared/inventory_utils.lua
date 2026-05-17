-- inventory_utils: shared inventory-unload helpers extracted from miningTunnel3.
-- Pre-emptively factored out so future mining programs (treeMiner, veinMiner,
-- etc.) can share the unload-to-chest behaviour instead of copy-pasting.
--
-- Usage:
--   local inv = require("inventory_utils")
--   if inv.unloadIsNeeded() then inv.dropOffItems(distance) end
--
-- Globals consumed: `tapi`, `turtle`, `peripheral`, `print`.
-- No module-level state; all helpers operate against the live turtle inventory.

local M = {}

function M.isInventoryEmpty()
  for i = 1, 16 do
    if turtle.getItemCount(i) > 0 then return false end
  end
  return true
end

function M.getChestFreeSlotCount(side)
  side = side or "front"
  local p = peripheral.wrap(side)
  if not p then return false end
  local slots = p.list()
  if not slots then return 0 end
  local freeSlots = 0
  for i, stack in pairs(slots) do
    if not stack then freeSlots = freeSlots + 1 end
  end
  return freeSlots
end

function M.dropOresIntoChest()
  for i = 1, 16 do
    while M.getChestFreeSlotCount("front") == 0 do tapi.up() end
    local stack = turtle.getItemDetail(i)
    if stack and stack.name ~= "minecraft:torch" then
      tapi.select(i)
      tapi.drop()
    end
  end
end

function M.dropCrapIntoChest()
  while not M.isInventoryEmpty() do
    for i = 1, 16 do
      while M.getChestFreeSlotCount("front") == 0 do tapi.up() end
      local stack = turtle.getItemDetail(i)
      print(stack and stack.name)
      if stack and (
        stack.name:match("minecraft:cobblestone") or
        stack.name:match("projectred-exploration:marble") or
        stack.name:match("minecraft:gravel") or
        stack.name:match("minecraft:dirt") or
        stack.name:match("quark:smooth_basalt") or
        stack.name:match("quark:cobbled_deepslate")
      ) then
        tapi.select(i)
        tapi.drop()
      end
    end
  end
end

function M.dropOffItems(i)
  local k = 0
  print("dropping off items")
  local old_pos = tapi.loc_internal
  local old_heading = tapi.loc_internal.h
  print(old_pos:tostring())
  tapi.up(1, true)
  tapi.left(2)
  tapi.forward(i, true)
  tapi.right()
  local _, block
  repeat
    tapi.f(1, true)
    k = k + 1
    _, block = turtle.inspect()
  until block and block.name == "minecraft:cobblestone"
  tapi.left()
  tapi.down(1, true)
  tapi.forward(1, true)
  M.dropCrapIntoChest()
  tapi.right()
  tapi.forward(1, true)
  repeat tapi.down() until turtle.detectDown()
  tapi.right()
  tapi.forward(2, true)
  tapi.right()
  tapi.forward(1, true)
  tapi.left()
  M.dropOresIntoChest()
  tapi.right(2)
  tapi.forward(1, true)
  repeat tapi.down() until turtle.detectDown()
  tapi.left()
  tapi.forward(k, true)
  tapi.turnTo(old_heading)
  tapi.up(1, true)
  tapi.forward(i, true)
  tapi.down(1, true)
end

function M.unloadIsNeeded()
  for i = 1, 16 do
    if turtle.getItemCount(i) == 0 then return false end
  end
  return true
end

function M.unloadIfNeeded(i)
  if M.unloadIsNeeded() then M.dropOffItems(i) end
end

return M
