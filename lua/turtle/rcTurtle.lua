-- os.loadAPI injects all tapi globals (forward, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("tapi")

local rc = require("rc_loop")(tapi)
rc.run()
