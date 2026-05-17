local miner = require('miner_utils')

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

for j = 1, 2 do
  for i = 0, 99 do
    miningOp(i)
  end
  tapi.right()
  for i = 0, 3 do
    miningOp(i)
  end
  tapi.right()
end
