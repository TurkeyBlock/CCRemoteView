os.loadAPI("capi")

local get_command_url    = capi.url .. "getCommand/"
local get_stop_url       = capi.url .. "getStopSignal/"

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
      capi.send_command_result(pcall(cmd))
    else
      print("error in loadstring(" .. cmd_string .. ")")
      capi.send_command_result(false, err)
    end
    res.close()
    capi.send_status_update()
  end
end

-- Forward chat events to the server (works in both HTTP and modem modes).
function monitor_chat()
  while true do
    local _, player, message, uuid = os.pullEvent("chat_message")
    capi.send_chat(player, message, uuid)
  end
end

-- HTTP mode: poll for a stop signal; sets the semaphore and returns when received.
function poll_stop_signal()
  while true do
    local json = textutils.serializeJSON({ id = os.getComputerID() })
    local res = http.post(get_stop_url, json, { ["Content-Type"] = "application/json" })
    if res then
      local stop_string = res.readAll()
      if string.find(stop_string, "true") then
        res.close()
        capi.locSemaphore.stopSignal = true
        while capi.locSemaphore.count > 0 do os.sleep(0.001) end
        return
      end
      res.close()
    end
    os.sleep(1)
  end
end

-- HTTP-based main loop with idle/sleep backoff.
function main()
  local idle_seconds  = 0
  local sleep_level   = 0  -- 0: active (5s), 1: light sleep (15s), 2: deep sleep (30s)
  local prev_sleep_level = 0
  capi.send_status_update()
  while true do
    local wait_seconds = sleep_level == 2 and 30 or sleep_level == 1 and 15 or 5
    os.sleep(wait_seconds)
    parallel.waitForAny(poll_stop_signal, get_command)
    if command_received then
      idle_seconds  = 0
      sleep_level   = 0
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
      capi.set_sleep_mode(sleep_level > 0)
      capi.send_status_update()
    end
    capi.locSemaphore.stopSignal = false
  end
end

-- Modem-based main loop: waits for commands and stop signals pushed by the modem server.
-- Runs the command while simultaneously watching for stop signals in parallel.
function modem_main()
  local MY_ID = os.getComputerID()
  capi.send_status_update()
  while true do
    local event, side, channel, reply_channel, message = os.pullEvent("modem_message")
    if channel == MY_ID and type(message) == "table" then

      if message.type == "stopSignal" then
        capi.locSemaphore.stopSignal = true
        while capi.locSemaphore.count > 0 do os.sleep(0.001) end
        capi.locSemaphore.stopSignal = false

      elseif message.type == "command" and message.command and message.command ~= "" then
        local cmd_string = message.command

        local function run_cmd()
          local cmd, err = loadstring(cmd_string)
          if cmd then
            setfenv(cmd, getfenv())
            capi.send_command_result(pcall(cmd))
          else
            capi.send_command_result(false, err)
          end
          capi.send_status_update()
        end

        -- Watch for a stop signal while the command executes (command yields during movement).
        local function watch_stop()
          while true do
            local ev, s, ch, rch, msg = os.pullEvent("modem_message")
            if ch == MY_ID and type(msg) == "table" and msg.type == "stopSignal" then
              capi.locSemaphore.stopSignal = true
              while capi.locSemaphore.count > 0 do os.sleep(0.001) end
              return
            end
          end
        end

        parallel.waitForAny(run_cmd, watch_stop)
        capi.locSemaphore.stopSignal = false
      end
    end
  end
end

if capi.use_modem then
  parallel.waitForAny(modem_main, monitor_chat)
else
  parallel.waitForAny(main, monitor_chat)
end
