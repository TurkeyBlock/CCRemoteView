local miner = require('miner_utils')

local function isTarget(b)
  return b and b.name and (b.name:find('log') or b.name:find('leaves'))
end

-- Tree mining uses the one-shot dig variants (no retry on falling blocks).
local digFns = { dig = tapi.dig, digUp = tapi.digUp, digDown = tapi.digDown }

-- local found, block = turtle.inspect()
-- if found and isTarget(block) then
miner.mineVein(isTarget, digFns)
-- end
