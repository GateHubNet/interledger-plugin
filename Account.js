"use strict";

const Error = require('./errors');

module.exports = (address) => {

    if (typeof address !== 'string') {
        throw new Error.InvalidFieldsError('account should be string in format: gateway_uuid.vault_uuid.user_uuid.wallet_address');
    }

    let parts = address.split('.');

    if (parts.length < 4) {
        throw new Error.InvalidFieldsError(`address format is invalid: ${address} should be gateway_uuid.vault_uuid.user_uuid.wallet_address`);
    }

    return {
        address: address,
        getLedger: function () { return `${parts[0]}.${parts[1]}`; },
        getGateway: function () { return parts[0]; },
        getWallet: function () { return parts[3]; },
        getUser: function () { return parts[2] },
        getVault: function () { return parts[1]; },
        getAccount: function () { return `${this.getLedger()}.${this.getUser()}` },

        getPrefix: function () { return `${this.getLedger()}.` },

        toString: function () {
            return address;
        }
    };
};