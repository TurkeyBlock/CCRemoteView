-- api_common: shared utilities for all computer API files (tapi/capi/papi/sapi).

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

return { make_ws_sender = make_ws_sender, gps_locate = gps_locate }
