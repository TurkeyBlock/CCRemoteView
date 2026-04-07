os.loadAPI("capi")

local get_command_url    = capi.url .. "getCommand/"
local get_stop_url       = capi.url .. "getStopSignal/"
local command_result_url = capi.url .. "commandResult/"
local chat_url           = capi.url .. "chat/"

local command_received = false

function send_command_result(succ, ret)
  local valid, payload = pcall(textutils.serializeJSON, {
    computerId = os.getComputerID(),
    result   = { succ = succ, ret = ret }
  })
  if not valid then
    payload = textutils.serializeJSON({
      computerId = os.getComputerID(),
      result   = { succ = false, ret = "error: result contains function which cannot be serialized" }
    })
  end
  local res = http.post(command_result_url, payload, { ["Content-Type"] = "application/json" })
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
      print("error in loadstring(" .. cmd_string .. ")")
      send_command_result(false, err)
    end
    res.close()
    capi.send_status_update()
  end
end

function monitor_chat()
  while true do
    local _, player, message, uuid = os.pullEvent("chat_message")
    local json = textutils.serializeJSON({
      id      = os.getComputerID(),
      player  = player,
      message = message,
      uuid    = uuid
    })
    local res = http.post(chat_url, json, { ["Content-Type"] = "application/json" })
    if res then res.close() end
  end
end

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

function main()
  local idle_seconds  = 0
  local sleep_level   = 0  -- 0: active (1s), 1: light sleep (5s), 2: deep sleep (30s)
  local prev_sleep_level = 0
  capi.send_status_update()
  while true do
    local wait_seconds = sleep_level == 2 and 30 or sleep_level == 1 and 5 or 1
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
        print("Entering light sleep - polling every 5 seconds")
      else
        print("Exiting sleep mode - resuming normal polling")
      end
      prev_sleep_level = sleep_level
      capi.set_sleep_mode(sleep_level > 0)
      capi.send_status_update()
    end
    capi.locSemaphore.stopSignal = false
  end
end

parallel.waitForAny(main, monitor_chat)
