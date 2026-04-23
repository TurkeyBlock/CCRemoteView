-- api_common: shared utilities for all computer API files (tapi/capi/papi/sapi).
-- Usage (inside an API file that is itself loaded via os.loadAPI):
--   local api_common = require("api_common")
--   local _m = api_common.make_modem(url)
--   use_modem = _m.use_modem
--   local modem_device = _m.modem_device   -- keep locally if needed for has_modem_peripheral
--
--   -- skip for tapi, which has its own actionSeq-aware version:
--   local _ws = api_common.make_ws_sender(url, headers)
--   set_ws              = _ws.set_ws
--   send_command_result = _ws.send_command_result

local function make_modem(url)
    local function discover_modem_id()
        local res = http.get(url .. "modem/id?computerId=" .. os.getComputerID())
        if res then
            local data = textutils.unserializeJSON(res.readAll())
            res.close()
            if data and data.id and data.enabled ~= false then return data.id end
        end
        return nil
    end

    local modem_device = peripheral.find("modem")
    local use_modem    = false
    if modem_device then
        local server_id = discover_modem_id()
        if server_id then
            modem_device.open(os.getComputerID())
            use_modem = true
            print("Modem mode: server ID " .. server_id)
        end
    end
    return { use_modem = use_modem, modem_device = modem_device }
end

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

return { make_modem = make_modem, make_ws_sender = make_ws_sender }
