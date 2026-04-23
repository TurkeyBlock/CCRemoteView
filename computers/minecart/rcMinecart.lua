-- os.loadAPI injects all capi globals (propel, scan, etc.) into this environment so browser commands can call them bare.
os.loadAPI("capi")

local WS_BASE = capi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local rc = require("rc_loop")(capi, WS_URL, {
    on_signal = function(msg, ws)
        if msg.type == "sideCommand" and msg.command and msg.command ~= "" then
            local side_cmd, err = loadstring(msg.command)
            if side_cmd then
                setfenv(side_cmd, getfenv())
                capi.send_command_result(pcall(side_cmd))
            else
                capi.send_command_result(false, err)
            end
        end
    end,
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
