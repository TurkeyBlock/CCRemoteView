local miner = require('miner_utils')

local function isTarget(b)
  return b and b.name and b.name:find('ore')
end

-- veinMiner uses the one-shot dig variants (matches the historical pre-extraction behaviour).
local digFns = { dig = tapi.dig, digUp = tapi.digUp, digDown = tapi.digDown }

-- local found, block = turtle.inspect()
-- if found and isTarget(block) then
miner.mineVein(isTarget, digFns)
-- end
