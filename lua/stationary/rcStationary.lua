-- os.loadAPI injects all sapi globals (sense, say, etc.) into this environment so browser commands can call them bare.
os.loadAPI("sapi")

local WS_BASE = sapi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(sapi, WS_URL)
rc.run()
