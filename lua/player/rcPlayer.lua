-- os.loadAPI injects all papi globals (scan, get_location, etc.) into this environment so browser commands can call them bare.
os.loadAPI("papi")

local rc = require("rc_loop")(papi, {
    -- session_parallel coroutines launch when the WS opens and die when it drops.
    session_parallel = { papi.gps_updater, papi.inventory_updater, papi.glasses_worker },
})
rc.run()
