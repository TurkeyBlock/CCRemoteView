-- Modem Server
-- Polls the HTTP server every 30s for WebSocket open requests and distributes
-- them to client computers via wireless modem. Each computer then opens its
-- own WebSocket directly to the server for all command traffic.
--
-- All HTTP requests are asynchronous (http.request) so the event loop is never
-- blocked by a long-running HTTP call.

-- !MUST END WITH '/api/'
local BASE_URL = "%%APP_URL%%/api/"

local modem = peripheral.find("modem") or error("No modem attached", 0)
local MODEM_ID = os.getComputerID()
local headers      = { ["Content-Type"] = "application/json" }
local text_headers = { ["Content-Type"] = "text/plain" }

local POLL_INTERVAL = 30  -- seconds between polls

print("Modem Server starting (ID: " .. MODEM_ID .. ")")
print("Poll interval: " .. POLL_INTERVAL .. "s")
print("Listening on channel " .. MODEM_ID)

modem.open(MODEM_ID)

local served_ids = {}
served_ids[MODEM_ID] = true  -- always include self

-- Attempt a one-shot GPS fix so the server can place this modem on the render.
local loc_x, loc_y, loc_z = gps.locate(3)
local modem_loc = loc_x and { x = loc_x, y = loc_y, z = loc_z } or nil
if modem_loc then
    print("GPS fix: " .. loc_x .. ", " .. loc_y .. ", " .. loc_z)
else
    print("GPS unavailable — modem will appear without location")
end

local REGISTER_URL  = BASE_URL .. "modem/register"
local POLL_URL      = BASE_URL .. "poll"
local COMPUTERS_URL = BASE_URL .. "modem/computers"
local RESEED_INTERVAL = 300  -- re-check registered computers every 5 minutes

local function register()
    local payload = textutils.serializeJSON({ id = MODEM_ID, loc = modem_loc, poll_interval = POLL_INTERVAL })
    http.request(REGISTER_URL, payload, headers)
end

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

local function fire_reseed()
    http.request({ url = COMPUTERS_URL, method = "GET" })
end

local polling_in_flight = false

local function fire_poll()
    if polling_in_flight then return end
    local ids = {}
    for id in pairs(served_ids) do table.insert(ids, id) end
    if #ids == 0 then return end
    polling_in_flight = true
    http.request(POLL_URL, table.concat(ids, ","), text_headers)
end

register()
seed_served_ids()

local poll_timer   = os.startTimer(0)
local reseed_timer = os.startTimer(RESEED_INTERVAL)

while true do
    local event, p1, p2, p3, p4 = os.pullEvent()

    if event == "timer" then
        if p1 == poll_timer then
            register()
            fire_poll()

        elseif p1 == reseed_timer then
            fire_reseed()
            reseed_timer = os.startTimer(RESEED_INTERVAL)
        end

    elseif event == "http_success" then
        local url, response = p1, p2
        if url == POLL_URL then
            local data = textutils.unserializeJSON(response.readAll()) or {}
            response.close()
            for id_str, _ in pairs(data.wsRequests or {}) do
                local id = tonumber(id_str)
                if id then
                    if id == MODEM_ID then
                        -- Open WS on self; not typical but handle gracefully
                        print("> openWs self (not yet implemented for modem server)")
                    else
                        modem.transmit(id, MODEM_ID, { type = "openWs" })
                        print("> openWs -> " .. id_str)
                    end
                end
            end
            polling_in_flight = false
            poll_timer = os.startTimer(POLL_INTERVAL)

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
            -- register and other fire-and-forget responses
            if response then response.close() end
        end

    elseif event == "http_failure" then
        local url = p1
        if url == POLL_URL then
            polling_in_flight = false
            poll_timer = os.startTimer(POLL_INTERVAL)
        end
    end
end
