-- os.loadAPI injects all capi globals (propel, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("capi")

local WS_BASE = capi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(capi, WS_URL, {
    extra_parallel = {
        function()
            while true do
                local _, player, message, uuid = os.pullEvent("chat_message")
                capi.send_chat(player, message, uuid)
            end
        end,
    },
})
rc.run()
