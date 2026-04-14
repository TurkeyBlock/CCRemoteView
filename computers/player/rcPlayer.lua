-- rcPlayer: playerComputer remote control loop.
-- Analogous to rcTurtle.lua for turtleComputers.
-- Fetches and executes commands from the server, supports stop-signal
-- cancellation, and provides both HTTP and modem transport.

os.loadAPI("papi")

local get_command_url     = papi.url .. "getCommand/"
local get_stop_signal_url = papi.url .. "getStopSignal/"

local command_received = false
local first_contact    = true

-- ─── HTTP transport ───────────────────────────────────────────

-- Fetch and execute the next queued command from the server.
function get_command()
    local payload = { id = os.getComputerID() }
    if first_contact then payload.first_contact = true end
    local json = textutils.serializeJSON(payload)
    local res  = http.post(get_command_url, json,
                           { ["Content-Type"] = "application/json" })
    if res then
        if first_contact then
            print("First server contact after reboot (id=" .. os.getComputerID() .. ")")
            first_contact = false
        end
        local cmd_string = res.readAll()
        res.close()
        if not cmd_string or cmd_string == "" then return end
        command_received = true

        local cmd, err = loadstring(cmd_string)
        if cmd then
            setfenv(cmd, getfenv())
            parallel.waitForAny(
                function() papi.send_command_result(pcall(cmd)) end,
                poll_stop_signal
            )
            papi.locSemaphore.stopSignal = false
        else
            print("error in loadstring(" .. cmd_string .. ")")
            papi.send_command_result(false, err)
        end
        papi.send_status_update()
    end
end

-- Poll for a stop signal; sets the semaphore and returns when received.
function poll_stop_signal()
    while true do
        local json = textutils.serializeJSON({ id = os.getComputerID() })
        local res  = http.post(get_stop_signal_url, json,
                               { ["Content-Type"] = "application/json" })
        if res then
            local stop_string = res.readAll()
            if string.find(stop_string, "true") then
                res.close()
                papi.locSemaphore.stopSignal = true
                while papi.locSemaphore.count > 0 do os.sleep(0.001) end
                return
            end
            res.close()
        end
        os.sleep(1)
    end
end

-- HTTP main loop with idle/sleep backoff.
function main()
    local idle_seconds  = 0
    local sleep_level   = 0   -- 0: active (1s), 1: light (15s), 2: deep (30s)
    local prev_sleep_level = 0
    local modem_check_elapsed  = 0
    local MODEM_CHECK_INTERVAL = 60

    papi.send_status_update()

    while true do
        local wait_seconds = sleep_level == 2 and 30
                          or sleep_level == 1 and 15
                          or 1
        os.sleep(wait_seconds)
        get_command()

        -- Reboot to connect via modem if a modem server came online since startup
        if peripheral.find("modem") then
            modem_check_elapsed = modem_check_elapsed + wait_seconds
            if modem_check_elapsed >= MODEM_CHECK_INTERVAL then
                modem_check_elapsed = 0
                local res = http.get(papi.url .. "modem/id")
                if res then
                    local data = textutils.unserializeJSON(res.readAll())
                    res.close()
                    if data and data.id then
                        print("Modem server online — rebooting to connect")
                        os.reboot()
                    end
                end
            end
        end

        if command_received then
            idle_seconds   = 0
            sleep_level    = 0
            command_received = false
        else
            idle_seconds = idle_seconds + wait_seconds
            if idle_seconds >= 300 then
                sleep_level = 2
            elseif idle_seconds >= 60 then
                sleep_level = 1
            end
        end

        if sleep_level ~= prev_sleep_level then
            if sleep_level == 2 then
                print("Entering deep sleep - polling every 30 seconds")
            elseif sleep_level == 1 then
                print("Entering light sleep - polling every 15 seconds")
            else
                print("Exiting sleep mode - resuming normal polling every 1 second")
            end
            prev_sleep_level = sleep_level
            papi.set_sleep_mode(sleep_level > 0)
            papi.send_status_update()
        end

        papi.locSemaphore.stopSignal = false
    end
end

-- ─── Modem transport ─────────────────────────────────────────

-- Modem-based main loop: waits for commands/stop signals pushed by the modem server.
-- Reboots after MAX_MISSES consecutive missed heartbeats.
function modem_main()
    local MY_ID           = os.getComputerID()
    local HEARTBEAT_WINDOW = 65   -- 60s interval + 5s grace
    local MAX_MISSES      = 3
    local missed_heartbeats = 0

    papi.send_status_update()
    local heartbeat_timer = os.startTimer(HEARTBEAT_WINDOW)

    while true do
        local event, p1, p2, p3, p4 = os.pullEvent()

        if event == "timer" and p1 == heartbeat_timer then
            missed_heartbeats = missed_heartbeats + 1
            print("Missed heartbeat #" .. missed_heartbeats)
            if missed_heartbeats >= MAX_MISSES then
                print("Modem timeout — rebooting to recover")
                os.reboot()
            end
            heartbeat_timer = os.startTimer(HEARTBEAT_WINDOW)

        elseif event == "modem_message" then
            local channel, message = p2, p4
            if channel == MY_ID and type(message) == "table" then
                -- Reset heartbeat timeout on any valid modem contact
                heartbeat_timer   = os.startTimer(HEARTBEAT_WINDOW)
                missed_heartbeats = 0

                if message.type == "heartbeat" then
                    -- keep-alive, nothing more needed

                elseif message.type == "stopSignal" then
                    papi.locSemaphore.stopSignal = true
                    while papi.locSemaphore.count > 0 do os.sleep(0.001) end
                    papi.locSemaphore.stopSignal = false

                elseif message.type == "command" then
                    print("cmd received, command field: " .. tostring(message.command))
                    if message.command and message.command ~= "" then
                        local cmd_string = message.command

                        local function run_cmd()
                            local cmd, err = loadstring(cmd_string)
                            if cmd then
                                setfenv(cmd, getfenv())
                                papi.send_command_result(pcall(cmd))
                            else
                                papi.send_command_result(false, err)
                            end
                            papi.send_status_update()
                        end

                        -- Watches for stop signals during command execution.
                        -- Also resets the modem timeout on heartbeat so long
                        -- commands don't false-trigger a reboot.
                        local function watch_stop()
                            while true do
                                local ev, s, ch, rch, msg = os.pullEvent("modem_message")
                                if ch == MY_ID and type(msg) == "table" then
                                    if msg.type == "stopSignal" then
                                        papi.locSemaphore.stopSignal = true
                                        while papi.locSemaphore.count > 0 do
                                            os.sleep(0.001)
                                        end
                                        return
                                    elseif msg.type == "heartbeat" then
                                        heartbeat_timer   = os.startTimer(HEARTBEAT_WINDOW)
                                        missed_heartbeats = 0
                                    end
                                end
                            end
                        end

                        parallel.waitForAny(run_cmd, watch_stop)
                        papi.locSemaphore.stopSignal = false
                    end
                end
            end
        end
    end
end

-- ─── Entry point ─────────────────────────────────────────────

if papi.use_modem then
    modem_main()
else
    main()
end
