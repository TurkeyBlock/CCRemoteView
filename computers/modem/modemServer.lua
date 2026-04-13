-- Modem Server
-- Polls the HTTP server for pending commands/stop signals and distributes them to
-- client computers via wireless modem. Client computers send state/scan/sense/chat/
-- commandResult directly to the HTTP server themselves.
--
-- All HTTP requests are asynchronous (http.request) so the event loop is never
-- blocked — timer events (poll, heartbeat, reseed) cannot be silently consumed by a
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
served_ids[MODEM_ID] = true  -- always include self so terminal commands are executed locally

-- Attempt a one-shot GPS fix so the server can place this modem on the render.
-- Runs synchronously here — safe because the event loop hasn't started yet.
local loc_x, loc_y, loc_z = gps.locate(3)
local modem_loc = loc_x and { x = loc_x, y = loc_y, z = loc_z } or nil
if modem_loc then
  print("GPS fix: " .. loc_x .. ", " .. loc_y .. ", " .. loc_z)
else
  print("GPS unavailable — modem will appear without location")
end

local register_json = textutils.serializeJSON({ id = MODEM_ID, loc = modem_loc })

local REGISTER_URL  = BASE_URL .. "modem/register"
local POLL_URL      = BASE_URL .. "poll"
local COMPUTERS_URL = BASE_URL .. "modem/computers"
local RESEED_INTERVAL = 300  -- re-check registered computers every 5 minutes

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

-- Async reseed: refresh served_ids from the server periodically so newly-registered
-- computers are discovered without requiring a modem restart.
local function fire_reseed()
  http.request({ url = COMPUTERS_URL, method = "GET" })
end

register()
seed_served_ids()

local poll_timer      = os.startTimer(0)
local heartbeat_timer = os.startTimer(HEARTBEAT_INTERVAL)
local reseed_timer    = os.startTimer(RESEED_INTERVAL)

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

    elseif p1 == reseed_timer then
      fire_reseed()
      reseed_timer = os.startTimer(RESEED_INTERVAL)
    end

  elseif event == "http_success" then
    local url, response = p1, p2
    if url == POLL_URL then
      local data = textutils.unserializeJSON(response.readAll()) or {}
      response.close()
      local activity = false
      for id_str, cmd in pairs(data.commands or {}) do
        if cmd and cmd ~= "" then
          if tonumber(id_str) == MODEM_ID then
            -- Execute on self rather than forwarding via modem
            local fn, err = loadstring(cmd)
            local result
            if fn then
              setfenv(fn, getfenv())
              local ok, val = pcall(fn)
              result = ok and textutils.serializeJSON(val) or ("error: " .. tostring(val))
            else
              result = "load error: " .. tostring(err)
            end
            print("> self-exec: " .. cmd)
            http.request(
              BASE_URL .. "commandResult",
              textutils.serializeJSON({ computerId = MODEM_ID, result = result }),
              headers
            )
          else
            modem.transmit(tonumber(id_str), MODEM_ID, { type = "command", command = cmd })
            print("> cmd -> " .. id_str)
          end
          activity = true
        end
      end
      for id_str, signal in pairs(data.stops or {}) do
        if signal then
          if tonumber(id_str) == MODEM_ID then
            print("> self-stop: rebooting")
            os.reboot()
          else
            modem.transmit(tonumber(id_str), MODEM_ID, { type = "stopSignal" })
            print("> stop -> " .. id_str)
          end
          activity = true
        end
      end
      for id_str, cmd in pairs(data.sides or {}) do
        if cmd and cmd ~= "" then
          modem.transmit(tonumber(id_str), MODEM_ID, { type = "sideCommand", command = cmd })
          print("> side -> " .. id_str)
          activity = true
        end
      end
      for id_str, msg in pairs(data.chats or {}) do
        if msg and msg ~= "" then
          modem.transmit(tonumber(id_str), MODEM_ID, { type = "chatSend", message = msg })
          print("> chat -> " .. id_str)
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
    elseif url == COMPUTERS_URL then
      local data = textutils.unserializeJSON(response.readAll()) or {}
      response.close()
      if data.ids then
        for _, id in ipairs(data.ids) do
          if not served_ids[id] then
            served_ids[id] = true
            print("+ discovered computer " .. tostring(id))
          end
        end
      end
    else
      -- register and any other fire-and-forget responses
      if response then response.close() end
    end

  elseif event == "http_failure" then
    local url = p1
    if url == POLL_URL then
      polling_in_flight = false
      poll_timer = os.startTimer(get_poll_interval())
    end
    -- Other failures (register, reseed): nothing to do.

  end
end
