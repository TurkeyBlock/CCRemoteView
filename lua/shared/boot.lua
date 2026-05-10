-- boot: shared startup bootstrap for all computer types.
-- Loaded by each startup script after being manually bootstrapped.
-- Usage: local boot = require("boot")
--        boot.check_approved(base_url, "turtle")
--        boot.get_files(base_url, "lua/shared/", {"boot.lua", "rc_loop.lua"})
--        boot.get_files(base_url, "lua/turtle/", {"tapi", "rcTurtle.lua", "startup"})

local function get_file(base_url, src_path, dest_name)
    local url = base_url .. src_path .. dest_name
    local res = http.get(url, nil)
    while not res do
        print("Error on GET " .. url .. " - retrying in 5 seconds")
        sleep(5)
        res = http.get(url, nil)
    end
    local f = fs.open(dest_name, "w")
    f.write(res.readAll())
    f.close()
    res.close()
    if dest_name == "startup" then
        if fs.exists("backup") then
            fs.delete("backup/startup")
        else
            fs.makeDir("backup")
        end
        if fs.exists("startup") then
            fs.copy("startup", "backup/startup")
        end
    end
end

local function get_files(base_url, src_path, files)
    term.write("autoupdate...")
    for _, name in ipairs(files) do
        get_file(base_url, src_path, name)
    end
    term.write("complete\n")
end

local function check_approved(base_url, device_name)
    while true do
        local res = http.post(
            base_url .. "api/getWsRequest",
            tostring(os.getComputerID()),
            { ["Content-Type"] = "text/plain" }
        )
        if res then
            local code = res.getResponseCode()
            local body = textutils.unserialiseJSON(res.readAll()) or {}
            res.close()
            if code == 200 then
                return true
            elseif code == 403 then
                term.clear()
                term.setCursorPos(1, 1)
                if body.status == "pending_ip" then
                    print("Waiting for IP approval...")
                    print("Approve this " .. device_name .. "'s IP in the admin panel.")
                elseif body.status == "pending_id" then
                    print("Waiting for " .. device_name .. " ID approval...")
                    print("IP approved. Approve " .. device_name .. " ID "
                          .. tostring(os.getComputerID()) .. " in the admin panel.")
                else
                    print("Waiting for admin approval...")
                end
                print("Retrying in 10 seconds.")
                sleep(10)
            else
                print("Unexpected response: " .. code)
                sleep(10)
            end
        else
            print("Could not reach server, retrying...")
            sleep(5)
        end
    end
end

return {
    check_approved = check_approved,
    get_files      = get_files,
}
