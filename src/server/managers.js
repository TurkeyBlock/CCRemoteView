'use strict';

const UserManagement    = require('./utils/userManagement');
const ComputerIpManager = require('./utils/computerIpManager');
const ComputerIdManager = require('./utils/computerIdManager');
const OperatorManager   = require('./utils/operatorManager');

function buildManagers(config = {}) {
  return {
    userManagement:    new UserManagement(config.users    ?? {}),
    computerIpManager: new ComputerIpManager(config.ips  ?? {}),
    computerIdManager: new ComputerIdManager(config.ids  ?? {}),
    operatorManager:   new OperatorManager(config.operators  ?? {}),
  };
}

module.exports = { buildManagers };
