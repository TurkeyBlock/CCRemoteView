-- Modem Server
-- Proactively polls the HTTP server for commands/stop signals and distributes them to
-- client computers via wireless modem. Client computers send state/scan/sense/chat/
-- commandResult to this server, which forwards them to the HTTP server.
--
-- All HTTP requests are asynchronous (http.request) so the event loop is never
-- blocked — timer events (poll, heartbeat) cannot be silently consumed by a
-- blocking http.post call.

-- !MUST END WITH '/api/'
local BASE_URL = "%%APP_URL%%/api/"
local HEARTBEAT_INTERVAL = 60  -- seconds between heartbeat broadcasts

local modem = peripheral.find("modem") or error("No modem attached", 0)
local MODEM_ID = os.getComputerID()
local headers = { ["Content-Type"] = "application/json" }

print("Modem Server starting (ID: " .. MODEM_ID .. ")")
print("Heartbeat: " .. HEARTBEAT_INTERVAL .. "s")
print("Listening on channel " .. MODEM_ID)

modem.open(MODEM_ID)

local served_ids = {}
local register_json = textutils.serializeJSON({ id = MODEM_ID })

local REGISTER_URL = BASE_URL .. "modem/register"
local POLL_URL     = BASE_URL .. "poll"

-- Idle/sleep state
local idle_seconds     = 0
local sleep_level      = 0  -- 0: active (1s), 1: light sleep (5s), 2: deep sleep (30s)
local prev_sleep_level = 0

local function get_poll_interval()
  if sleep_level == 2 then return 30
  elseif sleep_level == 1 then return 5
  else return 1 end
end

-- Fire-and-forget: notify the HTTP server this modem is alive.
local function register()
  http.request(REGISTER_URL, register_json, headers)
end

-- Synchronous seed at startup only — safe because the event loop hasn't started yet,
-- so no timer events exist to be silently consumed.
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

local polling_in_flight = false
local pending_wait      = 0  -- poll interval captured at fire time; used for idle accounting

-- Fire an async poll request. poll_timer is reset when the response arrives.
local function fire_poll()
  if polling_in_flight then return end
  local ids = {}
  for id in pairs(served_ids) do table.insert(ids, id) end
  if #ids == 0 then return end
  polling_in_flight = true
  pending_wait = get_poll_interval()
  http.request(POLL_URL, textutils.serializeJSON({ ids = ids }), headers)
end

local function send_heartbeat()
  for id in pairs(served_ids) do
    modem.transmit(id, MODEM_ID, { type = "heartbeat" })
  end
end

local endpoint_map = {
  state         = "state",
  scan          = "scan",
  sense         = "sense",
  chat          = "chat",
  commandResult = "commandResult",
}

-- Fire-and-forget: forward a modem message to the HTTP server.
-- Response is closed in the http_success handler.
local function forward_to_server(message)
  local computer_id = message.data and (message.data.id or message.data.computerId)
  if computer_id and not served_ids[computer_id] then
    served_ids[computer_id] = true
    print("+ registered computer " .. tostring(computer_id))
  end

  local endpoint = endpoint_map[message.type]
  if not endpoint or not message.data then return end
  local json = textutils.serializeJSON(message.data)
  http.request(BASE_URL .. endpoint, json, headers)
end

register()
seed_served_ids()

local poll_timer      = os.startTimer(0)
local heartbeat_timer = os.startTimer(HEARTBEAT_INTERVAL)

while true do
  local event, p1, p2, p3, p4 = os.pullEvent()

  if event == "timer" then
    if p1 == poll_timer then
      register()
      fire_poll()
      -- poll_timer is reset when http_success/failure for POLL_URL arrives,
      -- preserving the same per-response backpressure as the old synchronous code.

    elseif p1 == heartbeat_timer then
      send_heartbeat()
      heartbeat_timer = os.startTimer(HEARTBEAT_INTERVAL)
    end

  elseif event == "http_success" then
    local url, response = p1, p2
    if url == POLL_URL then
      local data = textutils.unserializeJSON(response.readAll()) or {}
      response.close()
      local activity = false
      for id_str, cmd in pairs(data.commands or {}) do
        if cmd and cmd ~= "" then
          modem.transmit(tonumber(id_str), MODEM_ID, { type = "command", command = cmd })
          print("> cmd -> " .. id_str)
          activity = true
        end
      end
      for id_str, signal in pairs(data.stops or {}) do
        if signal then
          modem.transmit(tonumber(id_str), MODEM_ID, { type = "stopSignal" })
          print("> stop -> " .. id_str)
          activity = true
        end
      end
      polling_in_flight = false
      if activity then
        idle_seconds = 0
        sleep_level  = 0
      else
        idle_seconds = idle_seconds + pending_wait
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
          print("Exiting sleep mode - resuming normal polling every 1 second")
        end
        prev_sleep_level = sleep_level
      end
      poll_timer = os.startTimer(get_poll_interval())
    else
      -- register, forward_to_server, and any other fire-and-forget responses
      if response then response.close() end
    end

  elseif event == "http_failure" then
    local url = p1
    if url == POLL_URL then
      polling_in_flight = false
      poll_timer = os.startTimer(get_poll_interval())
    end
    -- Other failures (register, forward_to_server): nothing to do.

  elseif event == "modem_message" then
    local message = p4
    if type(message) == "table" then
      forward_to_server(message)
    end
  end
end
