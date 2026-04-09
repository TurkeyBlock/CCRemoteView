os.loadAPI("capi")

local get_command_url    = capi.url .. "getCommand/"
local get_stop_url       = capi.url .. "getStopSignal/"

local command_received = false

-- HTTP mode: fetch and execute the next queued command from the server.
-- Stop signal polling runs in parallel only during command execution.
function get_command()
  local json = textutils.serializeJSON({ id = os.getComputerID() })
  local res = http.post(get_command_url, json, { ["Content-Type"] = "application/json" })
  if res then
    local cmd_string = res.readAll()
    res.close()
    if cmd_string == "" then return end
    command_received = true
    local cmd, err = loadstring(cmd_string)
    if cmd then
      setfenv(cmd, getfenv())
      parallel.waitForAny(
        function() capi.send_command_result(pcall(cmd)) end,
        poll_stop_signal,
        poll_side_commands
      )
      capi.locSemaphore.stopSignal = false
    else
      print("error in loadstring(" .. cmd_string .. ")")
      capi.send_command_result(false, err)
    end
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

-- HTTP mode: poll for side commands (e.g. scan) while a long command like propel_loop is running.
-- Runs a command immediately without interrupting the main command, then loops.
function poll_side_commands()
  local get_side_url = capi.url .. "getSideCommand/"
  while true do
    local json = textutils.serializeJSON({ id = os.getComputerID() })
    local res = http.post(get_side_url, json, { ["Content-Type"] = "application/json" })
    if res then
      local cmd_string = res.readAll()
      res.close()
      if cmd_string ~= "" then
        local cmd, err = loadstring(cmd_string)
        if cmd then
          setfenv(cmd, getfenv())
          capi.send_command_result(pcall(cmd))
        else
          capi.send_command_result(false, err)
        end
      end
    end
    os.sleep(1)
  end
end

-- HTTP-based main loop with idle/sleep backoff.
function main()
  local idle_seconds  = 0
  local sleep_level   = 0  -- 0: active (5s), 1: light sleep (15s), 2: deep sleep (30s)
  local prev_sleep_level = 0
  local modem_check_elapsed = 0
  local MODEM_CHECK_INTERVAL = 60
  capi.send_status_update()
  while true do
    local wait_seconds = sleep_level == 2 and 30 or sleep_level == 1 and 15 or 5
    os.sleep(wait_seconds)
    get_command()

    -- Reboot to connect via modem if a modem server came online since startup
    if peripheral.find("modem") then
      modem_check_elapsed = modem_check_elapsed + wait_seconds
      if modem_check_elapsed >= MODEM_CHECK_INTERVAL then
        modem_check_elapsed = 0
        local res = http.get(capi.url .. "modem/id")
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

-- Modem-based main loop: waits for commands/stop signals pushed by the modem server.
-- Reboots after MAX_MISSES consecutive missed heartbeats.
function modem_main()
  local MY_ID  = os.getComputerID()
  local HEARTBEAT_WINDOW = 65  -- seconds to wait per heartbeat (60s interval + 5s grace)
  local MAX_MISSES = 3
  local missed_heartbeats = 0
  capi.send_status_update()
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
        heartbeat_timer = os.startTimer(HEARTBEAT_WINDOW)  -- reset on any valid modem contact
        missed_heartbeats = 0

        if message.type == "heartbeat" then
          -- keep-alive, nothing more needed

        elseif message.type == "stopSignal" then
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

          -- Watches for stop signals and side commands during command execution.
          -- Also resets the modem timeout on heartbeat so long commands don't false-trigger.
          local function watch_stop()
            while true do
              local ev, s, ch, rch, msg = os.pullEvent("modem_message")
              if ch == MY_ID and type(msg) == "table" then
                if msg.type == "stopSignal" then
                  capi.locSemaphore.stopSignal = true
                  while capi.locSemaphore.count > 0 do os.sleep(0.001) end
                  return
                elseif msg.type == "heartbeat" then
                  heartbeat_timer = os.startTimer(HEARTBEAT_WINDOW)
                  missed_heartbeats = 0
                elseif msg.type == "sideCommand" and msg.command and msg.command ~= "" then
                  local side_cmd, err = loadstring(msg.command)
                  if side_cmd then
                    setfenv(side_cmd, getfenv())
                    capi.send_command_result(pcall(side_cmd))
                  else
                    capi.send_command_result(false, err)
                  end
                end
              end
            end
          end

          parallel.waitForAny(run_cmd, watch_stop)
          capi.locSemaphore.stopSignal = false
        end
      end
    end
  end
end

if capi.use_modem then
  parallel.waitForAny(modem_main, monitor_chat)
else
  parallel.waitForAny(main, monitor_chat)
end
