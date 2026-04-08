-- github: https://github.com/exa-byte/CCTurtleRemoteController
os.loadAPI("tapi")

local get_command_url = tapi.url .. "getCommand/"
local get_stop_signal_url = tapi.url .. "getStopSignal/"

local command_received = false

-- HTTP mode: fetch and execute the next queued command from the server.
function get_command()
    local json = textutils.serializeJSON({ id = os.getComputerID() })
    local res = http.post(get_command_url, json, { ["Content-Type"] = "application/json" })
    if res then
        local cmd_string = res.readAll()
        if cmd_string == "" then res.close(); return end
        command_received = true
        local cmd, err = loadstring(cmd_string)
        if cmd then
            setfenv(cmd, getfenv())
            tapi.send_command_result(pcall(cmd))
        else
            print("error in loadstring(" .. cmd_string .. ")");
            tapi.send_command_result(false, err)
        end
        res.close()
        tapi.send_status_update()
    end
end

-- HTTP mode: poll for a stop signal; sets the semaphore and returns when received.
function poll_stop_signal()
    while true do
        local json = textutils.serializeJSON({ id = os.getComputerID() })
        local res = http.post(get_stop_signal_url, json, { ["Content-Type"] = "application/json" })
        if res then
            local stop_string = res.readAll()
            if string.find(stop_string, "true") then
                res.close()
                tapi.locSemaphore.stopSignal = true
                while tapi.locSemaphore.count > 0 do os.sleep(0.001) end
                return
            end
            res.close()
        end
        os.sleep(1)
    end
end

-- HTTP-based main loop with idle/sleep backoff.
function main()
    local idle_seconds = 0
    local sleep_level = 0  -- 0: active (1s), 1: light sleep (15s), 2: deep sleep (30s)
    local prev_sleep_level = 0
    tapi.send_status_update()
    while true do
        local wait_seconds = sleep_level == 2 and 30 or sleep_level == 1 and 15 or 1
        os.sleep(wait_seconds)
        parallel.waitForAny(poll_stop_signal, get_command)
        if command_received then
            idle_seconds = 0
            sleep_level = 0
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
                print("Exiting sleep mode - resuming normal polling every 5 seconds")
            end
            prev_sleep_level = sleep_level
            tapi.set_sleep_mode(sleep_level > 0)
            tapi.send_status_update()
        end
        tapi.locSemaphore.stopSignal = false
    end
end

-- Modem-based main loop: waits for commands/stop signals pushed by the modem server.
-- Reboots if no modem contact for TIMEOUT seconds (handles modem server loss).
function modem_main()
    local MY_ID  = os.getComputerID()
    local TIMEOUT = 150  -- reboot after 2.5 missed heartbeat intervals (60s each)
    local SLEEP_CHECK = 60  -- idle check interval in seconds
    tapi.send_status_update()
    local timer_id = os.startTimer(TIMEOUT)

    local idle_seconds = 0
    local sleep_level = 0
    local sleep_check_id = os.startTimer(SLEEP_CHECK)

    local function reset_idle()
        idle_seconds = 0
        sleep_check_id = os.startTimer(SLEEP_CHECK)
        if sleep_level > 0 then
            sleep_level = 0
            print("Exiting sleep mode")
            tapi.set_sleep_mode(false)
            tapi.send_status_update()
        end
    end

    while true do
        local event, p1, p2, p3, p4 = os.pullEvent()

        if event == "timer" and p1 == timer_id then
            print("Modem timeout — rebooting to recover")
            os.reboot()

        elseif event == "timer" and p1 == sleep_check_id then
            idle_seconds = idle_seconds + SLEEP_CHECK
            sleep_check_id = os.startTimer(SLEEP_CHECK)
            local new_level = idle_seconds >= 300 and 2 or idle_seconds >= 60 and 1 or 0
            if new_level ~= sleep_level then
                sleep_level = new_level
                if sleep_level == 2 then
                    print("Entering deep sleep")
                elseif sleep_level == 1 then
                    print("Entering light sleep")
                end
                tapi.set_sleep_mode(sleep_level > 0)
                tapi.send_status_update()
            end

        elseif event == "modem_message" then
            local channel, message = p2, p4
            if channel == MY_ID and type(message) == "table" then
                timer_id = os.startTimer(TIMEOUT)  -- reset timeout on any valid modem contact

                if message.type == "heartbeat" then
                    -- keep-alive, nothing more needed

                elseif message.type == "stopSignal" then
                    reset_idle()
                    tapi.locSemaphore.stopSignal = true
                    while tapi.locSemaphore.count > 0 do os.sleep(0.001) end
                    tapi.locSemaphore.stopSignal = false

                elseif message.type == "command" and message.command and message.command ~= "" then
                    reset_idle()
                    local cmd_string = message.command

                    local function run_cmd()
                        local cmd, err = loadstring(cmd_string)
                        if cmd then
                            setfenv(cmd, getfenv())
                            tapi.send_command_result(pcall(cmd))
                        else
                            tapi.send_command_result(false, err)
                        end
                        tapi.send_status_update()
                    end

                    -- Watches for stop signals during command execution.
                    -- Also resets the modem timeout on heartbeat so long commands don't false-trigger.
                    local function watch_stop()
                        while true do
                            local ev, s, ch, rch, msg = os.pullEvent("modem_message")
                            if ch == MY_ID and type(msg) == "table" then
                                if msg.type == "stopSignal" then
                                    tapi.locSemaphore.stopSignal = true
                                    while tapi.locSemaphore.count > 0 do os.sleep(0.001) end
                                    return
                                elseif msg.type == "heartbeat" then
                                    timer_id = os.startTimer(TIMEOUT)
                                end
                            end
                        end
                    end

                    parallel.waitForAny(run_cmd, watch_stop)
                    tapi.locSemaphore.stopSignal = false
                end
            end
        end
    end
end

if tapi.use_modem then
    modem_main()
else
    main()
end
