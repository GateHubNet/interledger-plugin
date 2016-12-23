"use strict";

const chai = require('chai');
const mocha = require('mocha');
const mock = require('mock-require');
const chaiAsPromised = require('chai-as-promised');
mock('../gateways/gatehub', './mocks/gatehubMock');

const Plugin = require('../index');
let assert = chai.assert;
chai.use(chaiAsPromised);

let plugin = null;
let opts = {
    ledger: {
        gatewayUuid: 'dcd15f97-9b44-4e4b-8a2e-b87313a43d73',
        vaultUuid: '9c164c67-cc6d-424b-add5-8783a417e282',
        ilpUrl: 'http://localhost:8080',
        coreUrl: 'http://core.staging.svc.cluster.local/v1',
        notificationsUrl: '/notifications'
    },
    account: {
        userUuid: '5f059a8b-3921-5085-50c5-0250245b49b5',
        wallet: '69063371'
    }
};

let testTransfer = {
    uuid: 'd86b0299-e2fa-4713-833a-96a6a75271b8',
    amount: '100',
    sending_address: '11111111',
    receiving_address: opts.account.wallet,
    data: {},
    state: 'prepared',
    execution_condition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
    expires_at: '2016-05-18T12:00:00.000Z'
};

describe('address service', () => {
    before(done => {
        plugin = Plugin(opts);

        plugin.connect()
            .then(() => done())
            .catch(err => console.log(err));
    });

    describe('connection', () => {
        it('should be connected', (next) => {
            assert.isTrue(plugin.isConnected());
            next();
        });
    });

    describe('info', () => {
        it ('should get prefix', () => {
           return assert.eventually.equal(plugin.getPrefix(), `${opts.ledger.gatewayUuid}.${opts.ledger.vaultUuid}`);
        });

        it ('should return account', () => {
            return assert.eventually.equal(plugin.getAccount(), `${opts.ledger.gatewayUuid}.${opts.ledger.vaultUuid}.${opts.account.wallet}`);
        });
    });

    describe('message', () => {
        it('should emit message event on incoming message', (next) => {
            plugin.on('incoming_message', (data) => {
                assert.equal(data.data.foo, 'bar');
                next()
            });

            plugin.gatehub.testEmit('message', {
                method: 'message',
                ledger: 'example.ledger.',
                account: 'example.ledger.connector',
                data: { foo: 'bar' }
            });
        });
    });

    describe('transfers', () => {
        it ('should send transfer and validate it', (next) => {
            let transferRequest = {
                id: 'd86b0299-e2fa-4713-833a-96a6a75271b8',
                account: 'dcd15f97-9b44-4e4b-8a2e-b87313a43d73.9c164c67-cc6d-424b-add5-8783a417e282.123456789',
                amount: '10',
                data: '',
                noteToSelf: {},
                executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
                expiresAt: '2016-05-18T12:00:00.000Z'
            };

            plugin.gatehub.setCallback({
                transfer: function(transfer) {
                    assert.equal(transfer.amount, transferRequest.amount);
                    assert.equal(transfer.sending_address, opts.account.wallet);
                    assert.equal(transfer.receiving_address, '123456789');
                    assert.equal(transfer.vault_uuid, opts.ledger.vaultUuid);
                    next();
                }
            });

            plugin.sendTransfer(transferRequest);
        });

        it ('should fire outgoing prepare event', (next) => {
            plugin.on('outgoing_prepare', (data) => {
                assert.equal(data.account, `${opts.ledger.gatewayUuid}.${opts.ledger.vaultUuid}.11111111`);
                next();
            });

            plugin.gatehub.testEmit('transfer', {
                method: 'transfer.create',
                data: Object.assign({}, testTransfer, {
                    sending_address: testTransfer.receiving_address,
                    receiving_address: testTransfer.sending_address
                })
            });
        });

        it ('should fire incoming prepare event', (next) => {
            plugin.on('incoming_prepare', (data) => {
                next();
            });

            plugin.gatehub.testEmit('transfer', {
                method: 'transfer.create',
                data: Object.assign({}, testTransfer)
            });
        });

        it ('should fire incoming transfer event', (next) => {
            plugin.on('incoming_transfer', (data) => {
                next();
            });

            let transfer = Object.assign({}, testTransfer, { state: 'executed' });
            delete transfer.execution_condition;

            plugin.gatehub.testEmit('transfer', {
                method: 'transfer.create',
                data: transfer
            });
        });

        it ('should fire incoming fulfill event', (next) => {
            plugin.on('incoming_fulfill', (data) => {
                next();
            });

            plugin.gatehub.testEmit('transfer', {
                method: 'transfer.create',
                data: Object.assign({}, testTransfer, { state: 'executed', execution_fulfillment: 'ff:123' })
            });
        });

        it ('should fire incoming reject event', (next) => {
            plugin.on('incoming_cancel', (data) => {
                next();
            });

            plugin.gatehub.testEmit('transfer', {
                method: 'transfer.create',
                data: Object.assign({}, testTransfer, { state: 'rejected', cancellation_fulfilment: 'ff:123' })
            });
        });

    });

});