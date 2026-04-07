-- github: https://github.com/exa-byte/CCTurtleRemoteController
os.loadAPI("tapi")

local get_command_url = tapi.url .. "getCommand/"
local get_stop_signal_url = tapi.url .. "getStopSignal/"
local command_result_url = tapi.url .. "commandResult/"

local command_received = false

function send_command_result(succ, ret)
    local valid, cmd_result = pcall(textutils.serializeJSON, { turtleId = os.getComputerID(), result = { succ = succ, ret = ret } })
    if not valid then
        cmd_result = textutils.serializeJSON({ turtleId = os.getComputerID(), result = { succ = false, ret = "error: result contains function which cannot be serialized" } })
    end
    -- print("sending cmd_result: " .. tostring(succ) .. ", " .. tostring(ret))
    local res = http.post(command_result_url, cmd_result, { ["Content-Type"] = "application/json" })
    if res then res.close() end
end

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
            send_command_result(pcall(cmd))
        else
            print("error in loadstring(" .. cmd_string .. ")");
            send_command_result(false, err)
        end
        res.close()
        tapi.send_status_update()
    end
end

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

function main()
    local idle_seconds = 0
    local sleep_mode = false
    local prev_sleep_mode = false
    tapi.send_status_update()  -- Initial status update
    while true do
        local wait_seconds = sleep_mode and 30 or 1
        os.sleep(wait_seconds)
        parallel.waitForAny(poll_stop_signal, get_command)
        if command_received then
            idle_seconds = 0
            sleep_mode = false
            command_received = false
        else
            idle_seconds = idle_seconds + wait_seconds
            if idle_seconds > 60 then
                sleep_mode = true
            end
        end
        if sleep_mode ~= prev_sleep_mode then
            if sleep_mode then
                print("Entering sleep mode - polling every 30 seconds")
            else
                print("Exiting sleep mode - resuming normal polling")
            end
            prev_sleep_mode = sleep_mode
            tapi.set_sleep_mode(sleep_mode)
            tapi.send_status_update()
        end
        tapi.locSemaphore.stopSignal = false
    end
end

main()
