-- Modem Server
-- Acts as a proxy between computers and the HTTP server, batching requests to reduce load.
-- Configuration: Edit SERVED_COMPUTER_IDS below to specify which computers this modem serves.

-- !MUST END WITH '/api/'
local BASE_URL = "http://turtles.turkeyblock.org/api/"
local SERVED_COMPUTER_IDS = { 3, 4, 5, 10, 11, 12 }  -- Edit this list to add/remove served computers

local modem = peripheral.find("modem") or error("No modem attached", 0)
local MODEM_ID = os.getComputerID()

print("Modem Server starting (ID: " .. MODEM_ID .. ")")
print("Serving computer IDs: " .. table.concat(SERVED_COMPUTER_IDS, ", "))

-- Open channels for all served computers
for _, computer_id in ipairs(SERVED_COMPUTER_IDS) do
  modem.open(computer_id)
end

-- Batch of pending requests from computers
local pending_get_command = {}
local pending_get_stop_signal = {}

-- Make batched HTTP requests to the server
local function make_batched_requests()
  local get_command_ids = {}
  local get_stop_signal_ids = {}
  
  for computer_id in pairs(pending_get_command) do
    table.insert(get_command_ids, computer_id)
  end
  for computer_id in pairs(pending_get_stop_signal) do
    table.insert(get_stop_signal_ids, computer_id)
  end
  
  -- Make getCommand request if any computers waiting
  if #get_command_ids > 0 then
    local cmd_payload = textutils.serializeJSON({ ids = get_command_ids })
    local res = http.post(BASE_URL .. "getCommands", cmd_payload, { ["Content-Type"] = "application/json" })
    if res then
      local commands = textutils.unserializeJSON(res.readAll()) or {}
      res.close()
      -- Send responses back to each computer
      for computer_id, cmd in pairs(commands) do
        modem.transmit(tonumber(computer_id), MODEM_ID, { type = "command", command = cmd })
      end
    end
    pending_get_command = {}
  end
  
  -- Make getStopSignal request if any computers waiting
  if #get_stop_signal_ids > 0 then
    local stop_payload = textutils.serializeJSON({ ids = get_stop_signal_ids })
    local res = http.post(BASE_URL .. "getStopSignals", stop_payload, { ["Content-Type"] = "application/json" })
    if res then
      local stop_signals = textutils.unserializeJSON(res.readAll()) or {}
      res.close()
      -- Send responses back to each computer
      for computer_id, stop in pairs(stop_signals) do
        modem.transmit(tonumber(computer_id), MODEM_ID, { type = "stopSignal", signal = stop })
      end
    end
    pending_get_stop_signal = {}
  end
end

-- Main request handler
local function handle_request(request, sender_channel)
  if request.type == "getCommand" then
    pending_get_command[request.id] = true
  elseif request.type == "getStopSignal" then
    pending_get_stop_signal[request.id] = true
  elseif request.type == "state" then
    -- State updates are sent directly to server immediately
    local payload = textutils.serializeJSON(request.data)
    local res = http.post(BASE_URL .. "state", payload, { ["Content-Type"] = "application/json" })
    if res then res.close() end
  elseif request.type == "scan" then
    local payload = textutils.serializeJSON(request.data)
    local res = http.post(BASE_URL .. "scan", payload, { ["Content-Type"] = "application/json" })
    if res then res.close() end
  elseif request.type == "sense" then
    local payload = textutils.serializeJSON(request.data)
    local res = http.post(BASE_URL .. "sense", payload, { ["Content-Type"] = "application/json" })
    if res then res.close() end
  elseif request.type == "chat" then
    local payload = textutils.serializeJSON(request.data)
    local res = http.post(BASE_URL .. "chat", payload, { ["Content-Type"] = "application/json" })
    if res then res.close() end
  end
end

-- Main loop
while true do
  local event, side, channel, reply_channel, message, distance = os.pullEvent("modem_message")
  
  if type(message) == "table" then
    handle_request(message, reply_channel)
  end
  
  -- Every 5 requests or idle timeout, process batched command/stop signal requests
  -- (This can be adjusted - currently debounces rapidly)
  os.sleep(0.5)
  make_batched_requests()
end
