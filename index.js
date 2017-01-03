'use strict';

const EventEmitter = require('eventemitter2');
const debug = require('debug')('plugin');
const Promise = require('bluebird');
const Error = require('./errors');
const lo = require('lodash');
const Account = require('./Account');

/**
 * @param {Object} opts options for the ledger plugin, or an instantiated plugin object
 * @param {Object} opts.ledger Ledger configuration
 * @param {String} opts.urls.ilpUrl url of the ledger service
 * @param {String} opts.urls.coreUrl url of the core gatehub service
 * @param {String} opts.urls.notificationsUrl url endpoint of the notifications
 * @param {Object} opts.account Account string for the plugin - format: gateway_uuid.vault_uuid.user_uuid.wallet_address
 */
let plugin = (opts) => {

    if (!opts.urls || !opts.urls.notificationsUrl || !opts.urls.coreUrl || !opts.urls.ilpUrl) {
        throw new Error.InvalidFieldsError('urls object wrong format');
    }

    // set gateway for gatehub communication based if the plugin is locally called within
    // gatehub interledger service (due to optimization and stability we avoid websocket
    // communication with localhost) or remotely
    let GatehubGateway = require('./gateways/gatehubInternal');
    if (opts.gateway == 'local') {
        GatehubGateway = require('./gateways/gatehubLocal');
    }

    let connected = false;
    const urls = opts.urls;
    const account = Account(opts.account);
    const prefix = account.getPrefix();
    const gatehub = GatehubGateway(urls, account);

    // function to handle message events
    function handleMessage (message) {
        return this.emitAsync('incoming_message', Object.assign({}, {
            ledger: prefix,
            account: prefix + message.account,
        }, message.data));
    }

    // function to handle transfer events
    function handleTransfer (message) {
        let ghTransfer = message.data;

        let common = lo.omitBy({
            id: ghTransfer.uuid,
            ledger: prefix,
            amount: ghTransfer.amount,
            data: ghTransfer.data,
            noteToSelf: ghTransfer.note,
            executionCondition: ghTransfer.execution_condition,
            cancellationCondition: ghTransfer.cancellation_condition,
            expiresAt: ghTransfer.expires_at
        }, lo.isNil);

        // if ghTransfer is incoming
        if (ghTransfer.receiving_address == account.getWallet()) {
            let transfer = Object.assign({}, common, {
                direction: 'incoming',
                account: `${account.getAccount()}.${ghTransfer.sending_address}`
            });

            emitTransfer.call(this, 'incoming', ghTransfer, transfer);
        }
        // gh transfer is outgoing
        else if (ghTransfer.sending_address == account.getWallet()) {
            let transfer = Object.assign({}, common, {
                direction: 'outgoing',
                account: `${account.getAccount()}.${ghTransfer.receiving_address}`
            });

            emitTransfer.call(this, 'outgoing', ghTransfer, transfer);
        }
    }

    // TODO check incoming/outgoing

    function emitTransfer(direction, ghTransfer, transfer) {
        if (ghTransfer.state === 'prepared') {
            this.emitAsync(`${direction}_prepare`, transfer);
            debug(`${direction}_prepare`, transfer);
        }
        if (ghTransfer.state === 'executed' && !transfer.executionCondition) {
            this.emitAsync(`${direction}_transfer`, transfer);
            debug(`${direction}_transfer`, transfer);
        }
        if (ghTransfer.state === 'executed' && ghTransfer.execution_fulfillment) {
            this.emitAsync(`${direction}_fulfill`, transfer, ghTransfer.execution_fulfillment);
            debug(`${direction}_fulfill`, transfer);
        }
        if (ghTransfer.state === 'rejected' && ghTransfer.cancellation_fulfilment) {
            this.emitAsync(`${direction}_cancel`, transfer, ghTransfer.cancellation_fulfilment);
            debug(`${direction}_cancel`, transfer);
        }
        else if (ghTransfer.state === 'rejected') {
            this.emitAsync(`${direction}_cancel`, transfer, 'transfer timed out.');
            debug(`${direction}_cancel`, transfer);
        }
    }

    return Object.assign({
        gatehub: gatehub,

        connect: function () {
            debug(`connecting ${prefix}...`);

            gatehub.removeAllListeners('connect');
            gatehub.on('connect', () => {
                connected = true;
                this.emit('connect');
                debug('ws connected to gatehub');
            });

            gatehub.removeAllListeners('disconnect');
            gatehub.on('disconnect', () => {
                connected = false;
                this.emit('disconnect');
                debug('ws disconnected from gatehub');
            });

            gatehub.removeAllListeners('error');
            gatehub.on('error', (error) => {
                this.emit('error');
                debug('plugin error ', error);
            });

            gatehub.removeAllListeners('message');
            gatehub.on('message', (message) => {
                handleMessage.call(this, message);
            });

            gatehub.removeAllListeners('transfer');
            gatehub.on('transfer', (message) => {
                handleTransfer.call(this, message);
            });

            return gatehub.connect(opts)
                .tap(() => gatehub.subscribe());
        },

        disconnect: function () {
            connected = false;
            gatehub.disconnect();
            return Promise.resolve(null);
        },

        isConnected: function () {
            return connected;
        },

        getInfo: function () {
            debug('getting info');

            return gatehub.getInfo().then(info => {
                debug('got info', info);
                return info;
            });
        },

        getPrefix: function () {
            return Promise.resolve(prefix);
        },

        getAccount: function () {
            return Promise.resolve(account.toString());
        },

        getBalance: function () {
            debug('getting balance');

            return gatehub.getBalance().then(balances => {
                let balance = balances.filter(balance => balance.vault.uuid == account.getVault())[0];
                balance = balance.available ? balance.available : "0";

                debug('got balance', balance);
                return balance;
            });
        },

        sendTransfer: function (transfer) {
            // TODO validation
            debug('sending transfer', transfer);

            return gatehub.sendTransfer({
                uuid: transfer.id,
                sending_user_uuid: account.getUser(),
                sending_address: account.getWallet(),
                receiving_address: Account(transfer.account).getWallet(),
                vault_uuid: account.getVault(),
                amount: transfer.amount,
                data: transfer.data,
                note: transfer.noteToSelf,
                condition: transfer.executionCondition,
                expires_at: transfer.expiresAt
            }).then(transfer => {
                debug('got transfer response', transfer);
                return null;
            });
        },

        sendMessage: function (message) {
            return this.getAccount().then(from => {
                message.to = Account(message.account).toString();
                message.from = from;

                debug('sending message', message);

                return gatehub.sendMessage(message);
            });
        },

        getFulfillment: function (transferId) {
            debug('getting fulfillment', transferId);

            return gatehub.getFulfillment(transferId)
                .then(transfer => {
                    debug('got fulfillment', transfer);

                    if (transfer.execution_fulfillment) {
                        return transfer.execution_fulfillment;
                    }
                    else if (transfer.cancellation_fulfilment) {
                        throw new Error.AlreadyRolledBackError(`transfer ${transferId} wont be fulfilled`);
                    }
                    else {
                        throw new Error.MissingFulfillmentError(`transfer ${transferId} not yet fulfilled`);
                    }
                });
        },

        fulfillCondition: function (transferId, fulfillment) {
            debug('fulfilling transfer', transferId);

            return gatehub.fulfillCondition(transferId, fulfillment);
        },

        rejectIncommingTransfer: function (transferId, rejectMessage) {
            debug('rejecting transfer', transferId);

            return gatehub.rejectTransfer(transferId, rejectMessage);
        }

    }, EventEmitter.prototype);
};

module.exports = function Plugin (opts) { return plugin(opts); };
