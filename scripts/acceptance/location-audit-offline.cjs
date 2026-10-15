// Test-process guard only: no provider HTTP/TCP, database or delivery connections.
// This is not an OS network sandbox; tests use reviewed synthetic adapters.
const net = require('node:net');
net.Socket.prototype.connect = function () { throw new Error('AUDIT_OFFLINE_NETWORK_DENIED'); };
