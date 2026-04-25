-- api_common: shared utilities for all computer API files (tapi/capi/papi/sapi).

local function make_ws_sender(url, headers)
    local ws_conn = nil
    local function set_ws(ws) ws_conn = ws end
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
    return { set_ws = set_ws, send_command_result = send_command_result }
end

return { make_ws_sender = make_ws_sender }
