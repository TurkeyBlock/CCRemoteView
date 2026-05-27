-- os.loadAPI injects all mapi globals (propel, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("mapi")

local rc = require("rc_loop")(mapi)
rc.run()
