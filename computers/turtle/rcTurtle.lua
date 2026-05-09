-- os.loadAPI injects all tapi globals (forward, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("tapi")

local WS_BASE = tapi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(tapi, WS_URL)
rc.run()
