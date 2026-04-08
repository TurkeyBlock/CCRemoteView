-- Modem Server
-- Proactively polls the HTTP server for commands/stop signals and distributes them to
-- client computers via wireless modem. Client computers send state/scan/sense/chat/
-- commandResult to this server, which forwards them to the HTTP server.
--
-- Configuration: edit SERVED_COMPUTER_IDS and POLL_INTERVAL below, then copy to the
-- modem computer and run. Client computers must have MODEM_SERVER_ID set to this
-- computer's ID in their capi/tapi files.

-- !MUST END WITH '/api/'
local BASE_URL = "http://turtles.turkeyblock.org/api/"
local SERVED_COMPUTER_IDS = { 3, 4, 5, 10, 11, 12 }  -- Edit this list to add/remove served computers
local POLL_INTERVAL = 1  -- Seconds between polls for commands and stop signals

local modem = peripheral.find("modem") or error("No modem attached", 0)
local MODEM_ID = os.getComputerID()
local headers = { ["Content-Type"] = "application/json" }

print("Modem Server starting (ID: " .. MODEM_ID .. ")")
print("Serving: " .. table.concat(SERVED_COMPUTER_IDS, ", "))
print("Poll interval: " .. POLL_INTERVAL .. "s")
print("Listening on channel " .. MODEM_ID)

-- Open own channel so client computers can transmit to us
modem.open(MODEM_ID)

-- Pre-serialized payloads (don't change after startup)
local ids_json = textutils.serializeJSON({ ids = SERVED_COMPUTER_IDS })
local register_json = textutils.serializeJSON({ id = MODEM_ID })

-- Register this modem server's ID with the HTTP server so clients can discover it.
local function register()
  local res = http.post(BASE_URL .. "modem/register", register_json, headers)
  if res then res.close() end
end

-- Poll the HTTP server for pending commands and stop signals for all served computers,
-- then transmit any results directly to the appropriate computer's channel.
-- Re-registers each poll so clients can re-discover after a server restart.
local function poll_all()
  register()

  -- Batch getCommands
  local res = http.post(BASE_URL .. "getCommands", ids_json, headers)
  if res then
    local commands = textutils.unserializeJSON(res.readAll()) or {}
    res.close()
    for id_str, cmd in pairs(commands) do
      if cmd and cmd ~= "" then
        modem.transmit(tonumber(id_str), MODEM_ID, { type = "command", command = cmd })
        print("> cmd -> " .. id_str)
      end
    end
  end

  -- Batch getStopSignals
  res = http.post(BASE_URL .. "getStopSignals", ids_json, headers)
  if res then
    local signals = textutils.unserializeJSON(res.readAll()) or {}
    res.close()
    for id_str, signal in pairs(signals) do
      if signal then
        modem.transmit(tonumber(id_str), MODEM_ID, { type = "stopSignal" })
        print("> stop -> " .. id_str)
      end
    end
  end
end

-- Forward a message received from a client computer to the appropriate HTTP endpoint.
local endpoint_map = {
  state         = "state",
  scan          = "scan",
  sense         = "sense",
  chat          = "chat",
  commandResult = "commandResult",
}

local function forward_to_server(message)
  local endpoint = endpoint_map[message.type]
  if not endpoint or not message.data then return end
  local json = textutils.serializeJSON(message.data)
  local res = http.post(BASE_URL .. endpoint, json, headers)
  if res then res.close() end
end

-- Register immediately so clients that boot before the first timed poll can discover us.
register()

-- Main loop: fire an immediate poll, then alternate between timed polls and
-- handling forwarded data (state/scan/sense/chat/commandResult) from client computers.
local timer_id = os.startTimer(0)  -- poll immediately on start
while true do
  local event, p1, p2, p3, p4 = os.pullEvent()

  if event == "timer" and p1 == timer_id then
    poll_all()
    timer_id = os.startTimer(POLL_INTERVAL)

  elseif event == "modem_message" then
    -- p1=side, p2=channel, p3=replyChannel, p4=message
    local message = p4
    if type(message) == "table" then
      forward_to_server(message)
    end
  end
end
