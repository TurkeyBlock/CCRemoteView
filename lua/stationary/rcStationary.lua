-- os.loadAPI injects all sapi globals (sense, say, etc.) into this environment so browser commands can call them bare.
os.loadAPI("sapi")

local rc = require("rc_loop")(sapi)
rc.run()
