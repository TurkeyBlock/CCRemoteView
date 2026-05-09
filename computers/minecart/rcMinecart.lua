-- os.loadAPI injects all mapi globals (propel, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("mapi")

local WS_BASE = mapi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(mapi, WS_URL, {
    extra_parallel = {
        function()
            while true do
                local _, player, message, uuid = os.pullEvent("chat_message")
                mapi.send_chat(player, message, uuid)
            end
        end,
    },
})
rc.run()
