-- os.loadAPI injects all papi globals (scan, get_location, etc.) into this environment so browser commands can call them bare.
os.loadAPI("papi")

local rc = require("rc_loop")(papi, {
    -- session_parallel coroutines launch when the WS opens and die when it drops.
    session_parallel = { papi.gps_updater, papi.inventory_updater, papi.glasses_worker },
    -- extra_parallel coroutines run for the full lifetime of the computer program.
    extra_parallel   = { papi.glasses_chat_handler },
})
rc.run()
