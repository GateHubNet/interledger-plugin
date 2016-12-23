"use strict";

const EventEmitter = require('eventemitter2');
const Promise = require('bluebird');

module.exports = () => {

    return Object.assign({

        connect: function () {
            this.emit('connect');
            return Promise.resolve();
        },

        subscribe: function () {
            console.log('mock subscribed');
        },

        sendTransfer: function (id, account, amount, data, note, condition, expiresAt) {
            this.callbacks.transfer(id, account, amount, data, note, condition, expiresAt);
            return Promise.resolve({});
        },

        testEmit: function (event, data) {
            this.emit(event, data);
        },

        setCallback: function (callbacks) {
            this.callbacks = callbacks;
        }

    }, EventEmitter.prototype);
};