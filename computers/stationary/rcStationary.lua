-- os.loadAPI injects all sapi globals (sense, say, etc.) into this environment so browser commands can call them bare.
os.loadAPI("sapi")

local WS_BASE = sapi.url:gsub("/api/$", ""):gsub("^http", "ws")
local WS_URL  = WS_BASE .. "/ws/computer?id=" .. os.getComputerID()

local function handle_chat_send(msg)
    if msg.type == "chatSend" and msg.message then
        sapi.say(msg.message)
    end
end

local rc = require("rc_loop")(sapi, WS_URL, {
    on_signal = handle_chat_send,
    on_msg    = handle_chat_send,
    extra_parallel = {
        function()
            while true do
                local _, player, message, uuid = os.pullEvent("chat_message")
                sapi.send_chat(player, message, uuid)
            end
        end,
    },
})
rc.run()
