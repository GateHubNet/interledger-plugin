'use strict';

const EventEmitter = require('eventemitter2');
const debug = require('debug')('plugin');
const Promise = require('bluebird');
const gatehub = require('./gateways/gatehub');
const Error = require('./errors');
const lo = require('lodash');
const Condition = require('five-bells-condition');

module.exports = (opts) => {

    // TODO validate opts

    let connected = false;
    let ledger = opts.ledger;
    let account = opts.account;
    let prefix = `${opts.ledger.gatewayUuid}.${opts.ledger.vaultUuid}`;

    let cached = {};

    function parseAccount (account) {
        let parts = account.split('.');

        if (parts.length < 3) {
            throw new Error('');
        }

        return {
            wallet: parts[parts.length-1]
        };
    }

    // function to handle message events
    function handleMessage (message) {
        return this.emitAsync('incoming_message', {
            ledger: prefix,
            account: prefix + message.account,
            data: message.data
        });
    }

    // function to handle transfer events
    function handleTransfer (message) {
        let ghTransfer = message.data;

        let common = lo.omitBy({
            id: ghTransfer.uuid,
            ledger: prefix,
            amount: ghTransfer.amount,
            data: ghTransfer.data,
            executionCondition: ghTransfer.execution_condition,
            cancellationCondition: ghTransfer.cancellation_condition,
            expiresAt: ghTransfer.expires_at
        }, lo.isNil);

        // if ghTransfer is incoming
        if (ghTransfer.receiving_address == account.wallet) {
            let transfer = Object.assign({}, common, {
                direction: 'incoming',
                account: `${prefix}.${ghTransfer.sending_address}`
            });

            emitTransfer.call(this, 'incoming', ghTransfer, transfer);
        }
        // gh transfer is outgoing
        else if (ghTransfer.sending_address == account.wallet) {
            let transfer = Object.assign({}, common, {
                direction: 'outgoing',
                account: `${prefix}.${ghTransfer.receiving_address}`
            });

            emitTransfer.call(this, 'outgoing', ghTransfer, transfer);
        }
    }

    function emitTransfer(direction, ghTransfer, transfer) {
        if (ghTransfer.state === 'prepared') {
            this.emitAsync(`${direction}_prepare`, transfer);
        }
        if (ghTransfer.state === 'executed' && !transfer.executionCondition) {
            this.emitAsync(`${direction}_transfer`, transfer);
        }
        if (ghTransfer.state === 'executed' && ghTransfer.execution_fulfillment) {
            this.emitAsync(`${direction}_fulfill`, transfer, ghTransfer.execution_fulfillment);
        }
        if (ghTransfer.state === 'rejected' && ghTransfer.cancellation_fulfilment) {
            this.emitAsync(`${direction}_cancel`, transfer, ghTransfer.cancellation_fulfilment);
        }
        else if (ghTransfer.state === 'rejected') {
            this.emitAsync(`${direction}_cancel`, transfer, 'transfer timed out.');
        }
    }

    return Object.assign({

        connect: function () {
            debug('connecting...');

            gatehub.removeAllListeners('connect');
            gatehub.on('connect', () => {
                connected = true;
                this.emit('connect');
                debug('connected to gatehub');
            });

            gatehub.removeAllListeners('disconnect');
            gatehub.on('disconnect', () => {
                connected = false;
                this.emit('disconnect');
                debug('disconnected from gatehub');
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
            //if (cached.info) {
            //    return Promise.resolve(cached.info);
            //}

            return gatehub.getInfo();
                //.tap(info => cached.info = info);
        },

        getPrefix: function () {
            return Promise.resolve(prefix);
        },

        getAccount: function () {
            return Promise.resolve(`${prefix}.${account.wallet}`);
        },

        getBalance: function () {
            return gatehub.getBalance().then(balances => {
                let balance = balances.filter(balance => balance.vault.uuid == ledger.vaultUuid)[0];
                return balance.available ? balance.available : "0";
            });
        },

        sendTransfer: function (transfer) {
            // TODO validation

            return gatehub.sendTransfer({
                uuid: transfer.id,
                sending_address: account.wallet,
                receiving_address: parseAccount(transfer.account).wallet,
                vault_uuid: ledger.vaultUuid,
                amount: transfer.amount,
                data: transfer.data,
                note: transfer.noteToSelf,
                condition: transfer.executionCondition,
                expires_at: transfer.expiresAt
            });
        },

        sendMessage: function (message) {
            return gatehub.sendMessage(message);
        },

        getFulfillment: function (transferId) {
            return gatehub.getFulfillment(transferId)
                .then(transfer => {
                    if (transfer.execution_fulfillment) {
                        return transfer.execution_fulfillment;
                    }
                    else if (transfer.cancellation_fulfilment) {
                        throw new Error.AlreadyRolledBackError(`transfer ${transferId} wont be fulfilled`);
                    }
                    else {
                        throw new Error.MissingFulfillmentError(`transfer ${tranferId} not yet fulfilled`);
                    }
                })
                .catch(err => {
                    throw new Error.TransferNotFoundError(`transfer ${transferId} not found`);
                });
        },

        fulfillCondition: function (transferId, fulfillment) {
            try {
                Condition.validateCondition(fulfillment);
            }
            catch (err) {
                throw new Error.InvalidFieldsError('fulfillment not valid format');
            }

            return gatehub.fulfillCondition(transferId, fulfillment);
        },

        rejectIncommingTransfer: function (transferId, rejectMessage) {
            return gatehub.rejectTransfer(transferId, rejectMessage);
        }

    }, EventEmitter.prototype);
};
