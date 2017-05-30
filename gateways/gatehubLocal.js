"use strict";

const EventEmitter = require('eventemitter2');
const Debug = require('debug');
const Promise = require('bluebird');

module.exports = (urls, account, services) => {

    let debug = Debug(`plugin:local:${account.getWallet()}`);

    return Object.assign({
        account: null,
        connected: false,

        connect: function () {
            this.urls = urls;
            this.account = account;

            this.emit('connect');

            return Promise.resolve(null);
        },

        disconnect: function () {

        },

        // subscribe to all account notifications
        subscribe: function () {
            let address = `${this.account.getVault()}.${this.account.getWallet()}`;
            return services.notification.subscribe(address, (method, data) => {
                debug('got event ', method, data);

                this.emit(method, { method: method, data: data });
            });
        },

        getInfo: function () {
            return services.ledger.getInfo(this.account.getGateway(), this.account.getVault())
                .then(info => info.toJSON());
        },

        getBalance: function () {

        },

        getFulfillment: function (uuid) {
            return services.ledger.getTransfer(uuid)
                .then(transfer => transfer.toJSON());
        },

        fulfillCondition: function (uuid, fulfillment) {
            return services.ledger.fulfillTransfer(uuid, fulfillment).then(res => null);
        },

        rejectTransfer: function (uuid, rejection) {

        },

        sendTransfer: function (adapted) {
            return services.ledger.prepareTransfer(adapted.uuid, adapted.sending_user_uuid,
                adapted.sending_address, adapted.receiving_address, adapted.vault_uuid,
                adapted.amount, adapted.ilp, adapted.note, adapted.condition, adapted.expires_at)
                .then(res => null);
        },

        sendMessage: function (message) {
            return services.notification.message(message.from, message.to, message.ledger, message.data)
                .then(data => null);
        }

    }, EventEmitter.prototype);

};