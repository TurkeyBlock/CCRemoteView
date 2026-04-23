-- os.loadAPI injects all papi globals (scan, get_location, etc.) into this environment so browser commands can call them bare.
os.loadAPI("papi")

local WS_BASE = papi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(papi, WS_URL)
rc.run()
