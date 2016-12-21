"use strict";

const EventEmitter = require('eventemitter2');
const debug = require('debug')('gatehub');
const WebSocket = require('ws');
const request = require('request-promise');
const reconnectCore = require('reconnect-core');
const Promise = require('bluebird');

module.exports = Object.assign({
    connection: null,
    requestId: 0,
    ws: null,
    ilpApi: null,
    coreApi: null,
    ledger: null,
    account: null,
    connected: false,

    connect: function (opts) {
        if (this.connected) {
            debug('already connected');
            return Promise.resolve(null);
        }

        this.ledger = opts.ledger;
        this.account = opts.account;

        // TODO get auth token

        this.ilpApi = request.defaults({
            baseUrl: this.ledger.ilpUrl,
            json: true, headers: {'x-gatehub-uuid': this.account.userUuid}
        });

        this.coreApi = request.defaults({
            baseUrl: this.ledger.coreUrl,
            json: true, headers: {'x-gatehub-uuid': this.account.userUuid}
        });

        return new Promise((resolve, reject) => {
            const url = this.ledger.ilpUrl.replace("http", "ws") + this.ledger.notificationsUrl;
            const reconnect = reconnectCore(() => new WebSocket(url));

            this.connection = reconnect({immediate: true}, (ws) => {
                ws.on('open', () => {
                    debug('ws connected', url);

                    this.connected = true;
                    this.emit('connect');
                });

                ws.on('message', (data) => {
                    debug('ws got message', data);

                    let message;
                    try {
                        message = JSON.parse(data);
                    } catch (err) {
                        debug('invalid notification', data);
                        return;
                    }

                    if (message.method === 'connect') {
                        debug('ws established', url);
                        return resolve(null);
                    }
                    else if (message.method == 'message') {
                        this.emit('message', message);
                    }
                    else if (message.method.includes('transfer')) {
                        this.emit('transfer', message);
                    }
                });

                ws.on('error', () => {
                    debug('ws connection error on ' + this.ledger.notificationsUrl);
                    Promise.reject(); //reject(new UnreachableError('websocket connection error'));
                });

                ws.on('close', () => {
                    debug('ws disconnected from ' + this.ledger.notificationsUrl);
                    if (this.connected) {
                        Promise.reject(); //reject(new UnreachableError('websocket connection error'))
                    }
                });

                // reconnect-core expects the disconnect method to be called: `end`
                ws.end = ws.close
            });

            this.connection
                .on('connect', (websocket) => {
                    this.ws = websocket;
                })
                .on('disconnect', () => {
                    this.ws = null;
                    this.connected = false;
                    this.emit('disconnect');
                })
                .on('error', (err) => {
                    debug('ws error on ' + this.ledger.notificationsUrl + ':', err);
                    reject(err);
                })
                .connect();

        });
    },

    disconnect: function () {
        const emitter = this.connection;
        if (!emitter) return;

        this.connection = null;
        // WebSocket#end doesn't exist, so reconnect-core#disconnect is no good.
        emitter.reconnect = false;
        if (emitter._connection) {
            emitter._connection.close();
        }
    },

    subscribe: function () {
        debug('subscribing for ', this.account.wallet);

        return this.sendWs('subscribe', { account: this.account.wallet });
    },

    sendWs: function (method, params) {
        if (this.ws == null) { return Promise.reject(); }

        var requestId = ++this.requestId;
        return new Promise((resolve, reject) => {
            const listener = (rpcResponse) => {
                if (rpcResponse.id !== requestId) {
                    return;
                }
                // Wait till nextTick to remove the listener so that it doesn't happen while the
                // event is part way through being emitted, which causes issues iterating the listeners.
                process.nextTick(() => this.removeListener('ws:response', listener));
                if (rpcResponse.error) {
                    return reject(new ExternalError(rpcResponse.error.message));
                }
                resolve(rpcResponse);
            };

            this.on('ws:response', listener);

            debug('websocket send ' + method + ' ' + JSON.stringify(params));
            this.ws.send(JSON.stringify({jsonrpc: '2.0', id: this.requestId, method, params}));

            resolve(); // TODO resolve when approved that received
        });
    },

    getInfo: function () {
        if (this.connected == false) {
            return Promise.reject();
        }

        return this.ilpApi({
            method: 'get',
            uri: `/gateways/${this.ledger.gatewayUuid}/vaults/${this.ledger.vaultUuid}`
        });
    },

    getBalance: function () {
        return this.coreApi({method: 'get', uri: `/wallets/${this.account.wallet}/balances`});
    },

    getFulfillment: function (uuid) {
        return this.ilpApi({method: 'get', uri: `/transfers/${uuid}`});
    },

    fulfillCondition: function (uuid, fulfillment) {
        return this.ilpApi({method: 'put', uri: `/transfers/${uuid}`, body: {
            fulfillment: fulfillment
        }});
    },

    rejectTransfer: function (uuid, rejection) {
        return this.ilpApi({method: 'put', uri: `/transfers/${uuid}`, body: {
            rejection: rejection
        } });
    },

    sendTransfer: function (adapted) {
        return this.ilpApi({ method: 'post', uri: `/transfers`, body: adapted });
    },

    sendMessage: function (message) {
        return this.ilpApi({method: 'post', uri: '/messages', body: message})
            .then(() => null);
    }

}, EventEmitter.prototype);