-- Modem Server
-- Proactively polls the HTTP server for commands/stop signals and distributes them to
-- client computers via wireless modem. Client computers send state/scan/sense/chat/
-- commandResult to this server, which forwards them to the HTTP server.
--
-- Served computer IDs are seeded from the HTTP server on startup and updated dynamically
-- as computers check in. A heartbeat is broadcast every 60 seconds so computers can
-- detect modem loss and reboot to recover.

-- !MUST END WITH '/api/'
local BASE_URL = "http://turtles.turkeyblock.org/api/"
local POLL_INTERVAL      = 1   -- seconds between command/stop-signal polls
local HEARTBEAT_INTERVAL = 60  -- seconds between heartbeat broadcasts

local modem = peripheral.find("modem") or error("No modem attached", 0)
local MODEM_ID = os.getComputerID()
local headers = { ["Content-Type"] = "application/json" }

print("Modem Server starting (ID: " .. MODEM_ID .. ")")
print("Poll: " .. POLL_INTERVAL .. "s  Heartbeat: " .. HEARTBEAT_INTERVAL .. "s")
print("Listening on channel " .. MODEM_ID)

-- Open own channel so client computers can transmit to us
modem.open(MODEM_ID)

-- Served computer IDs — seeded from server on startup, updated as computers check in
local served_ids = {}  -- { [id] = true }

local register_json = textutils.serializeJSON({ id = MODEM_ID })

-- Register this modem server's ID with the HTTP server so clients can discover it.
local function register()
  local res = http.post(BASE_URL .. "modem/register", register_json, headers)
  if res then res.close() end
end

-- Seed served_ids from the HTTP server so we can poll for computers that were known
-- before this modem started (handles modem server restarts cleanly).
local function seed_served_ids()
  local res = http.get(BASE_URL .. "modem/computers")
  if res then
    local data = textutils.unserializeJSON(res.readAll()) or {}
    res.close()
    if data.ids then
      for _, id in ipairs(data.ids) do
        if not served_ids[id] then
          served_ids[id] = true
          print("+ seeded computer " .. tostring(id))
        end
      end
    end
  end
end

-- Poll the HTTP server for pending commands and stop signals, distribute via modem.
-- Re-registers on each poll so clients can re-discover after a server restart.
local function poll_all()
  register()

  local ids = {}
  for id in pairs(served_ids) do table.insert(ids, id) end
  if #ids == 0 then return end

  local ids_json = textutils.serializeJSON({ ids = ids })

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

-- Broadcast a heartbeat to all served computers so they can detect modem loss.
local function send_heartbeat()
  for id in pairs(served_ids) do
    modem.transmit(id, MODEM_ID, { type = "heartbeat" })
  end
end

-- Forward a message from a client computer to the HTTP server, and register its ID.
local endpoint_map = {
  state         = "state",
  scan          = "scan",
  sense         = "sense",
  chat          = "chat",
  commandResult = "commandResult",
}

local function forward_to_server(message)
  local computer_id = message.data and (message.data.id or message.data.computerId)
  if computer_id and not served_ids[computer_id] then
    served_ids[computer_id] = true
    print("+ registered computer " .. tostring(computer_id))
  end

  local endpoint = endpoint_map[message.type]
  if not endpoint or not message.data then return end
  local json = textutils.serializeJSON(message.data)
  local res = http.post(BASE_URL .. endpoint, json, headers)
  if res then res.close() end
end

-- Startup: register with HTTP server and seed known computers before first poll.
register()
seed_served_ids()

-- Main loop
local poll_timer      = os.startTimer(0)               -- poll immediately
local heartbeat_timer = os.startTimer(HEARTBEAT_INTERVAL)

while true do
  local event, p1, p2, p3, p4 = os.pullEvent()

  if event == "timer" then
    if p1 == poll_timer then
      poll_all()
      poll_timer = os.startTimer(POLL_INTERVAL)
    elseif p1 == heartbeat_timer then
      send_heartbeat()
      heartbeat_timer = os.startTimer(HEARTBEAT_INTERVAL)
    end

  elseif event == "modem_message" then
    -- p1=side, p2=channel, p3=replyChannel, p4=message
    local message = p4
    if type(message) == "table" then
      forward_to_server(message)
    end
  end
end
