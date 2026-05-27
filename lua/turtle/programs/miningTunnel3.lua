local miner = require('miner_utils')
local inv = require('inventory_utils')

local function isTarget(b)
  return b and b.name and b.name:find('ore')
end

local function miningOp(i)
  tapi.digRepeat()
  tapi.forward()
  miner.mineVein(isTarget)
  tapi.digUpRepeat()
  if tapi.selectItem("minecraft:cobblestone") or tapi.selectItem("quark:cobbled_deepslate") then
    tapi.placeDown()
    tapi.select(1)
  end
  if i % 12 == 0 then
    tapi.right(2)
    tapi.selectItem("minecraft:torch")
    tapi.place()
    tapi.right(2)
    tapi.select(1)
  end
end

local start_pos = tapi.loc_internal;
print("startPos="..start_pos:tostring())
local length = 250
for i = 1, length do
  miningOp(i)
  inv.unloadIfNeeded(i)
end
tapi.right(2)
tapi.up(1, true)
tapi.forward(length, true)
tapi.down(1, true)
tapi.right(2)
inv.dropOffItems(0)
