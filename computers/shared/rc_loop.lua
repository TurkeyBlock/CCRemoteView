-- rc_loop: shared WebSocket command loop for all computer types.
-- Usage:
--   local make_rc = require("rc_loop")
--   local rc = make_rc(api, ws_url, {
--     on_msg         = function(msg) ... end,
--     extra_parallel = { fn1, fn2 },
--   })
--   rc.run()
--
-- Command execution modes (set via the "concurrent" field on the message):
--
--   [sequential] (default, concurrent=false/nil)
--     For commands that take in-game actions or depend on exclusive state:
--     movement, digging, placing, item transfers, crafting, any write to
--     turtle/world state. Run strictly one at a time via the sequential queue.
--     Supports locks={"name"} for finer-grained exclusion (default: {"command"}).
--
--   [concurrent] (concurrent=true)
--     For passive read-only queries that do not modify turtle or world state:
--     scans, sensor reads, location lookups, inventory queries, fuel checks.
--     Spawned into their own coroutine and run in parallel with other concurrent
--     commands. Must NOT call movement, dig, place, drop, suck, craft, or any
--     operation that writes to shared state.
--
-- All API functions are [sequential] by default unless explicitly marked [concurrent].

local locks     = require("locks")
local make_sched = require("scheduler")

return function(api, ws_url, opts)
    opts = opts or {}

    local IDLE_TIMEOUT     = 300
    local queue            = {}  -- sequential
    local concurrent_queue = {}  -- concurrent
    local idle_timer       = nil
    local sched            = make_sched()

    local function reset_idle_timer()
        if idle_timer then os.cancelTimer(idle_timer) end
        idle_timer = os.startTimer(IDLE_TIMEOUT)
    end

    local function push(raw)
        reset_idle_timer()
        table.insert(queue, raw)
        os.queueEvent("task_queued")
    end

    local function push_concurrent(raw)
        reset_idle_timer()
        table.insert(concurrent_queue, raw)
        os.queueEvent("concurrent_queued")
    end

    -- SEQUENTIAL EXECUTOR: one command at a time, with lock support and stop-signal interrupt.
    local function executor_fn()
        while true do
            while #queue == 0 do
                os.pullEvent("task_queued")
            end

            local raw = table.remove(queue, 1)
            local msg = textutils.unserializeJSON(raw)

            if not msg then
                print("[rc_loop] could not parse message")
            elseif msg.type == "command" and msg.command and msg.command ~= "" then
                print("[rc_loop] seq: " .. tostring(msg.command):sub(1, 60))
                local lock_names = msg.locks or { "command" }
                locks.acquire(lock_names)

                local exec_ok, exec_err = pcall(function()
                    local cmd, load_err = loadstring(msg.command)
                    if cmd then
                        setfenv(cmd, getfenv())
                        parallel.waitForAny(
                            function() api.send_command_result(pcall(cmd)) end,
                            function()
                                os.pullEvent("stop_signal")
                                queue = {}
                                concurrent_queue = {}
                            end
                        )
                    else
                        print("[rc_loop] loadstring error: " .. tostring(load_err))
                        api.send_command_result(false, load_err)
                    end
                end)
                if not exec_ok then print("[rc_loop] seq command error: " .. tostring(exec_err)) end

                locks.release(lock_names)
                local ok, err = pcall(api.send_status_update)
                if not ok then print("[rc_loop] send_status_update error: " .. tostring(err)) end
            elseif opts.on_msg then
                opts.on_msg(msg)
            end
        end
    end

    -- CONCURRENT DISPATCHER: drains concurrent_queue into scheduler threads, then ticks them.
    -- When idle, sleeps until a new concurrent command arrives.
    local function concurrent_dispatcher_fn()
        while true do
            while #concurrent_queue > 0 do
                local raw = table.remove(concurrent_queue, 1)
                sched.start(function()
                    local msg = textutils.unserializeJSON(raw)
                    if not msg then return end
                    if msg.type == "command" and msg.command and msg.command ~= "" then
                        print("[rc_loop] conc: " .. tostring(msg.command):sub(1, 60))
                        local cmd, load_err = loadstring(msg.command)
                        if cmd then
                            setfenv(cmd, getfenv())
                            parallel.waitForAny(
                                function() api.send_command_result(pcall(cmd)) end,
                                function() os.pullEvent("stop_signal") end
                            )
                        else
                            api.send_command_result(false, load_err)
                        end
                        api.send_status_update()
                    elseif opts.on_msg then
                        opts.on_msg(msg)
                    end
                end)
                os.sleep(0) -- yield dispatcher between coroutine starts to prevent CC instruction-limit kill
            end

            if sched.is_idle() then
                os.pullEvent("concurrent_queued")
            else
                sched.tick({ os.pullEvent() })
            end
        end
    end

    -- TERMINAL: injects player input into the appropriate queue.
    -- Prefix a command with '&' to route it to the concurrent queue (e.g. "&scan()").
    -- Unprefixed commands go to the sequential queue.
    local function terminal_fn()
        while true do
            io.write("> ")
            local input = read()
            if input and input ~= "" then
                if input:sub(1, 1) == "&" then
                    push_concurrent(textutils.serializeJSON({ type = "command", command = input:sub(2), concurrent = true }))
                else
                    push(textutils.serializeJSON({ type = "command", command = input }))
                end
            end
        end
    end

    -- RECEIVER: feeds incoming WS messages into the appropriate queue.
    -- stopSignal bypasses both queues and fires immediately as an event.
    local function receiver_fn(ws)
        while true do
            local ok, raw = pcall(function() return ws.receive() end)
            if not ok or raw == nil then return end
            local msg = textutils.unserializeJSON(raw)
            if msg and msg.type == "stopSignal" then
                os.queueEvent("stop_signal")
            elseif msg and msg.concurrent then
                push_concurrent(raw)
            else
                push(raw)
            end
        end
    end

    -- SESSION: manages one WS connect/reconnect cycle and its idle timeout.
    local function run_session()
        local active_ws = nil

        local function session_loop()
            local MAX_RETRIES = 10
            local retries     = 0
            while retries < MAX_RETRIES do
                print("Connecting WS... (attempt " .. (retries + 1) .. "/" .. MAX_RETRIES .. ")")
                local ws, err = http.websocket(ws_url)
                if not ws then
                    retries = retries + 1
                    print("WS failed: " .. tostring(err) .. ", retrying in 2s (" .. retries .. "/" .. MAX_RETRIES .. ")")
                    os.sleep(2)
                else
                    retries   = 0
                    active_ws = ws
                    api.set_ws(ws)
                    api.send_status_update()

                    local ok, err = pcall(receiver_fn, ws)

                    api.set_ws(nil)
                    ws.close()
                    active_ws = nil

                    if not ok then print("WS session error: " .. tostring(err)) end
                    print("WS dropped, reconnecting in 2s")
                    os.sleep(2)
                end
            end
            print("WS failed " .. MAX_RETRIES .. " times, giving up")
        end

        local function idle_watcher()
            while true do
                local _, id = os.pullEvent("timer")
                if id == idle_timer then
                    print("Idle for " .. IDLE_TIMEOUT .. "s, stopping")
                    if active_ws then active_ws.close() end
                    break
                end
            end
        end

        reset_idle_timer()
        parallel.waitForAny(session_loop, idle_watcher)
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
                    local ok, err = pcall(api.send_status_update)
                    if not ok then print("[rc_loop] post-session send_status_update error: " .. tostring(err)) end
                end
            end
            os.sleep(30)
        end
    end

    return {
        run = function()
            api.send_status_update()
            local extras = opts.extra_parallel or {}
            print("Polling for WS request every 30s (id=" .. os.getComputerID() .. ")")
            parallel.waitForAny(poll_fn, executor_fn, concurrent_dispatcher_fn, terminal_fn, unpack(extras))
        end
    }
end
