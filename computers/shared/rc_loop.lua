-- rc_loop: shared WebSocket command loop for all computer types.
-- Usage:
--   local make_rc = require("rc_loop")
--   local rc = make_rc(api, ws_url, {
--     on_signal      = function(msg, ws) ... end,  -- extra msg types in watch_ws_signals
--     on_msg         = function(msg) ... end,       -- extra msg types in the main WS loop
--     extra_parallel = { fn1, fn2 },                -- run alongside the main poll/modem loop
--   })
--   rc.run()

return function(api, ws_url, opts)
    opts = opts or {}

    local IDLE_TIMEOUT = 300
    local last_active  = 0  -- os.clock() timestamp of last received message; set on session start

    -- Returns true if the WS was closed (receive returned nil), false otherwise.
    local function watch_ws_signals(ws)
        while true do
            local raw = ws.receive()
            if raw == nil then return true end
            local msg = textutils.unserializeJSON(raw)
            if not msg then
                -- ignore
            elseif msg.type == "stopSignal" then
                api.locSemaphore.stopSignal = true
                while api.locSemaphore.count > 0 do os.sleep(0.001) end
                return false
            elseif opts.on_signal then
                opts.on_signal(msg, ws)
            end
        end
    end

    -- Returns true if the WS was closed during handling and the outer loop should break.
    local function handle_msg(ws, raw)
        last_active = os.clock()
        print("[rc_loop] msg received (" .. #raw .. " bytes)")
        local msg = textutils.unserializeJSON(raw)
        if not msg then
            print("[rc_loop] could not parse message")
        elseif msg.type == "command" and msg.command and msg.command ~= "" then
            print("[rc_loop] executing command: " .. tostring(msg.command):sub(1, 60))
            local cmd, load_err = loadstring(msg.command)
            if cmd then
                setfenv(cmd, getfenv())
                local ws_closed = false
                parallel.waitForAny(
                    function() api.send_command_result(pcall(cmd)) end,
                    function() ws_closed = watch_ws_signals(ws) end
                )
                api.locSemaphore.stopSignal = false
                if ws_closed then
                    print("[rc_loop] WS closed during command execution")
                    return true
                end
            else
                print("[rc_loop] loadstring error: " .. tostring(load_err))
                api.send_command_result(false, load_err)
            end
            api.send_status_update()
        elseif msg.type == "stopSignal" then
            api.locSemaphore.stopSignal = true
            while api.locSemaphore.count > 0 do os.sleep(0.001) end
            api.locSemaphore.stopSignal = false
        elseif opts.on_msg then
            opts.on_msg(msg)
        end
        return false
    end

    -- Runs the full WS session: initial connect, message loop, and reconnect on drop.
    -- A single idle timer spans the entire session (active + reconnect gaps).
    -- Resets on each received message. Stops everything if it fires.
    local function run_session()
        last_active = os.clock()
        local active_ws = nil

        local function idle_watcher()
            while true do
                local remaining = IDLE_TIMEOUT - (os.clock() - last_active)
                if remaining <= 0 then break end
                os.sleep(remaining)
            end
            if active_ws then active_ws.close() end
            print("Idle for " .. IDLE_TIMEOUT .. "s, stopping")
        end

        local function session_loop()
            local MAX_RETRIES = 10
            local retries = 0
            while retries < MAX_RETRIES do
                print("Opening WebSocket to server... (attempt " .. (retries + 1) .. "/" .. MAX_RETRIES .. ")")
                local ws, err = http.websocket(ws_url)
                if not ws then
                    retries = retries + 1
                    print("WS failed: " .. tostring(err) .. ", retrying in 2s (" .. retries .. "/" .. MAX_RETRIES .. ")")
                    os.sleep(2)
                else
                    retries = 0
                    print("WS connected")
                    active_ws = ws
                    api.set_ws(ws)

                    local ok, err = pcall(function()
                        api.send_status_update()
                        while true do
                            local rok, raw = pcall(function() return ws.receive() end)
                            if not rok or raw == nil then break end
                            handle_msg(ws, raw)
                        end
                    end)

                    api.set_ws(nil)
                    ws.close()
                    active_ws = nil

                    if not ok then
                        print("WS session error: " .. tostring(err))
                    end
                    print("WS dropped, reconnecting in 2s")
                    os.sleep(2)
                end
            end
            print("WS failed " .. MAX_RETRIES .. " times, giving up")
        end

        parallel.waitForAny(session_loop, idle_watcher)
        -- Cleanup in case idle_watcher killed session_loop mid-session
        api.set_ws(nil)
        if active_ws then active_ws.close() end
    end

    local function poll_fn()
        while true do
            local res = http.post(api.url .. "getWsRequest", tostring(os.getComputerID()),
                                  { ["Content-Type"] = "text/plain" })
            if res then
                local body = res.readAll()
                res.close()
                local data = textutils.unserializeJSON(body)
                if data and data.open then
                    run_session()
                    api.send_status_update()
                end
            end
            os.sleep(30)
        end
    end

    local function modem_fn()
        local MY_ID = os.getComputerID()
        while true do
            local event, p1, p2, p3, p4 = os.pullEvent()
            if event == "modem_message" then
                local channel, message = p2, p4
                if channel == MY_ID and type(message) == "table" then
                    if message.type == "openWs" then
                        print("Modem: WS open requested")
                        run_session()
                        api.send_status_update()
                    end
                end
            end
        end
    end

    return {
        run = function()
            api.send_status_update()
            local extras = opts.extra_parallel or {}
            if api.use_modem then
                print("Modem mode: waiting for WS request (id=" .. os.getComputerID() .. ")")
                parallel.waitForAny(modem_fn, unpack(extras))
            else
                print("Polling for WS request every 30s (id=" .. os.getComputerID() .. ")")
                parallel.waitForAny(poll_fn, unpack(extras))
            end
        end
    }
end
