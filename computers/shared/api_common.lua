-- api_common: shared utilities for all computer API files (tapi/mapi/papi/sapi).

-- [concurrent] Live GPS fix, 2s timeout. Returns raw x, y, z or nil, nil, nil if unavailable.
local function gps_locate()
    local x, y, z = gps.locate(2)
    if not x then return nil, nil, nil end
    return x, y, z
end

local function make_ws_sender(url, headers)
    local ws_conn = nil
    local function set_ws(ws) ws_conn = ws end

    local function ws_or_post(msg_type, data, http_path)
        if ws_conn then
            ws_conn.send(textutils.serializeJSON({ type = msg_type, data = data }))
        else
            local json = textutils.serializeJSON(data)
            local res = http.post(url .. http_path, json, headers)
            if res then res.close() end
        end
    end

    local function send_command_result(succ, ret)
        local result
        if pcall(textutils.serializeJSON, { succ = succ, ret = ret }) then
            result = { succ = succ, ret = ret }
        else
            result = { succ = false, ret = "error: result not serializable" }
        end
        local json = textutils.serializeJSON({ type = "commandResult", computerId = os.getComputerID(), result = result })
        if ws_conn then
            ws_conn.send(json)
        else
            local res = http.post(url .. "commandResult", json, headers)
            if res then res.close() end
        end
    end

    local function send_scan(payload)
        ws_or_post("scan", payload, "scan")
    end

    local function send_status_update(payload)
        ws_or_post("statusUpdate", payload, "statusUpdate")
    end

    local function send_state(payload)
        ws_or_post("state", payload, "state/")
    end

    local function send_sense(payload)
        ws_or_post("sense", payload, "sense")
    end

    return {
        set_ws = set_ws,
        send_command_result = send_command_result,
        send_scan = send_scan,
        send_status_update = send_status_update,
        send_state = send_state,
        send_sense = send_sense,
    }
end

-- Build a filtered blocks array from a raw peripheral scan result.
-- filter_self: exclude the block at relative (0,0,0) (the computer's own position).
local function build_scan_blocks(raw, include_metadata, include_state, filter_self)
    local blocks = {}
    for _, b in ipairs(raw) do
        if not (filter_self and b.x == 0 and b.y == 0 and b.z == 0) then
            local entry = { x = b.x, y = b.y, z = b.z, name = b.name }
            if include_metadata then entry.metadata = b.metadata end
            if include_state and b.state and next(b.state) then entry.state = b.state end
            table.insert(blocks, entry)
        end
    end
    return blocks
end

-- POST a scan payload to /api/scan over HTTP.
-- Scan payloads often exceed CC:Tweaked's 128 KiB WebSocket message limit, so HTTP is always used.
-- Returns true, or false + error string on failure.
local function send_scan_http(url, headers, payload)
    local ok, json = pcall(textutils.serializeJSON, payload)
    if not ok then return false, "serialization error: " .. tostring(json) end
    local res = http.post(url .. "scan", json, headers)
    if not res then return false, "http post failed" end
    local code = res.getResponseCode and res.getResponseCode() or 200
    res.close()
    if code ~= 200 then return false, "server error: " .. tostring(code) end
    return true
end

-- Returns a sense() function that reads a plethora:sensor and reports entity data.
-- get_origin: function() -> {x,y,z} | nil  called each time to get the sensor's world position.
local function make_sense_fn(ws_sender, get_origin)
    return function()
        local sensor = peripheral.find("plethora:sensor")
        if not sensor then return false, "no plethora:sensor attached" end
        local raw = sensor.sense()
        local entities = {}
        for _, e in ipairs(raw) do
            table.insert(entities, { id = e.id, name = e.name, x = e.x, y = e.y, z = e.z })
        end
        local payload = { id = os.getComputerID(), entities = entities }
        local origin = get_origin()
        if origin then payload.origin = origin end
        ws_sender.send_sense(payload)
        print("? entity scan (" .. #entities .. " entities)")
        return true
    end
end

-- Returns a send_chat(player, message, uuid) function that POSTs to /api/chat.
local function make_send_chat(url, headers)
    return function(player, message, uuid)
        local data = { id = os.getComputerID(), player = player, message = message, uuid = uuid or "" }
        local json = textutils.serializeJSON(data)
        local res = http.post(url .. "chat", json, headers)
        if res then res.close() end
    end
end

return {
    make_ws_sender    = make_ws_sender,
    gps_locate        = gps_locate,
    build_scan_blocks = build_scan_blocks,
    send_scan_http    = send_scan_http,
    make_sense_fn     = make_sense_fn,
    make_send_chat    = make_send_chat,
}
