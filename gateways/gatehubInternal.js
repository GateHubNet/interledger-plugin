"use strict";

const EventEmitter = require('eventemitter2');
const Debug = require('debug');
const WebSocket = require('ws');
const request = require('request-promise');
const reconnectCore = require('reconnect-core');
const Promise = require('bluebird');
const UnreachableError = require('../errors/unreachable-error');

/**
 * GateHub internal is the gateway to gatehub service communication without needed authentication
 * due to placment of the service in the internal DMZ
 * @param {Object} urls object of urls
 * @param {Object} urls.coreUrl url of the gh core service
 * @param {Object} urls.ilpUrl url of the gh interledger service
 * @param {Object} urls.notificationsUrl url of the gh notification service
 * @param {String} account address of the plugin - format: gateway_uuid.vault_uuid.user_uuid.wallet_address
 * @returns {*}
 */
module.exports = (urls, account) => {

    let debug = Debug(`plugin:internal:${account.getWallet()}`);

    return Object.assign({
        connection: null,
        requestId: 0,
        ws: null,
        ledger: null,
        account: null,
        connected: false,

        ilpApi: request.defaults({
            baseUrl: urls.ilpUrl,
            json: true, headers: {'x-gatehub-uuid': account.getUser()}
        }),
        coreApi: request.defaults({
            baseUrl: urls.coreUrl,
            json: true, headers: {'x-gatehub-uuid': account.getUser()}
        }),

        connect: function () {
            if (this.connected) {
                debug('already connected');
                return Promise.resolve(null);
            }

            this.urls = urls;
            this.account = account;

            // TODO abstract this to notifications gateway
            return new Promise((resolve, reject) => {
                let url = this.urls.ilpUrl.replace("http", "ws") + this.urls.notificationsUrl;

                const reconnect = reconnectCore(() => new WebSocket(url, { headers : {
                    authorization: "Bearer abdd5d98fbcd2d1653635e67a2c45dd74482166bc"
                }} ));

                this.connection = reconnect({immediate: true}, (ws) => {
                    ws.on('open', () => {
                        debug('ws open', url);
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
                            this.connected = true;
                            this.emit('connect');
                            return resolve(null);
                        }
                        else if (message.method == 'message') {
                            this.emit('message', message);
                        }
                        else if (message.method && message.method.includes('transfer')) {
                            this.emit('transfer', message);
                        }
                        else if (message.result) {
                            this.emit('result', message);
                        }
                        else {
                            debug('ws got invalid message', data);
                        }
                    });

                    ws.on('error', () => {
                        debug('ws connection error on ' + this.urls.notificationsUrl);
                        Promise.reject(new UnreachableError('websocket connection error'));
                    });

                    ws.on('close', () => {
                        debug('ws disconnected from ' + this.urls.notificationsUrl);
                        if (this.connected) {
                            Promise.reject(new UnreachableError('websocket connection error'))
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
                        debug('ws error on ' + this.urls.notificationsUrl + ':', err);
                        reject(err);
                    })
                    .connect();

            });
        },

        disconnect: function () {
            const emitter = this.connection;
            if (!emitter) return;

            this.connection = null;
            emitter.reconnect = false;
            if (emitter._connection) {
                emitter._connection.close();
            }
        },

        // subscribe to all account notifications
        subscribe: function () {
            debug('subscribing for ', this.account.getWallet());

            let address = `${this.account.getVault()}.${this.account.getWallet()}`;
            return this.sendWs('subscribe', { account: address });
        },

        // send over websocket
        sendWs: function (method, params) {
            if (this.ws == null) {
                throw new UnreachableError();
            }

            return new Promise((resolve, reject) => {
                debug('websocket send ' + method + ' ' + JSON.stringify(params));
                this.ws.send(JSON.stringify({jsonrpc: '2.0', id: ++this.requestId, method, params}));

                resolve(); // TODO resolve when approved that received
            });
        },

        getInfo: function () {
            return this.ilpApi({
                method: 'get',
                uri: `/gateways/${this.account.getGateway()}/vaults/${this.account.getVault()}`
            });
        },

        getBalance: function () {
            return this.coreApi({method: 'get', uri: `/wallets/${this.account.getWallet()}/balances`});
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
            return this.ilpApi({ method: 'post', uri: '/messages', body: message })
                .then(() => null);
        }

    }, EventEmitter.prototype);
};