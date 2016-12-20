"use strict";


const mockSocket = require('./mocks/mockSocket');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const nock = require('nock');
const mock = require('mock-require');
const Error = require('../errors');

mock('ws', mockSocket.WebSocket);

const Plugin = require('../index');

chai.use(chaiAsPromised);
let assert = chai.assert;
let plugin = null;

let opts = {
    ledger: {
        gatewayUuid: 'g1',
        vaultUuid: 'v1',
        ilpUrl: 'http://ilp.local',
        coreUrl: 'http://core.local/v1',
        notificationsUrl: '/notifications'
    },
    account: {
        userUuid: 'u1',
        wallet: 'w1'
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


describe('Interledger Plugin', () => {

    beforeEach(next => {
        this.plugin = Plugin(opts);

        this.ilpMock = nock(opts.ledger.ilpUrl);
        this.coreMock = nock(opts.ledger.coreUrl);
        this.wsMock = mockSocket.makeServer(opts.ledger.ilpUrl.replace('http', 'ws') + opts.ledger.notificationsUrl);

        this.plugin.once('connect', () => next());
        this.plugin.connect();
    });

    afterEach(() => {
        this.wsMock.stop();
    });

    describe ('Info', () => {

        it ('should connect and return promise', () => {
            this.plugin = Plugin(opts);
            return assert.eventually.equal(this.plugin.connect(), null);
        });

        it ('should be connected', () => {
            return assert.equal(this.plugin.isConnected(), true);
        });

        it ('should get prefix', () => {
            return assert.eventually.equal(this.plugin.getPrefix(), "g1.v1");
        });

        it ('should get ledger precision and scale', () => {
            this.ilpMock.get(`/gateways/${opts.ledger.gatewayUuid}/vaults/${opts.ledger.vaultUuid}`)
                .replyWithFile(200, __dirname + '/mocks/info1.json');

            return assert.eventually.deepEqual(this.plugin.getInfo(), require('./mocks/info1.json'));
        });

        it ('should get account balance', () => {
            this.coreMock.get(`/wallets/${opts.account.wallet}/balances`)
                .replyWithFile(200, __dirname + '/mocks/balance1.json');

            return assert.eventually.equal(this.plugin.getBalance(), "98452");
        });

        it ('should disconnect the plugin', (next) => {
            this.plugin.on('disconnect', () => next());

            return assert.eventually.equal(this.plugin.disconnect(), null);
        });

    });


    describe ('Messages', () => {

        it ('should send message and notify plugin', next => {
            this.ilpMock.post('/messages').reply(200);

            let data = {
                source_amount: "100.25",
                source_address: "g2.v2.u2",
                destination_address: "g1.v1.u1",
                source_expiry_duration: "6000",
                destination_expiry_duration: "5"
            };

            this.plugin.on('incoming_message', message => {
                assert.deepEqual(data, message.data);
                next();
            });

            this.plugin.sendMessage({ account: 'u1', ledger: 'g1.v1', data: data }).then(() => {
                this.wsMock.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    method: 'message',
                    data: data
                }));
            });
        });

    });


    describe ('Transfers', () => {

        it ('should make transfer', () => {
            this.ilpMock.post('/transfers').reply(200);

            let transferRequest = {
                id: 'd86b0299-e2fa-4713-833a-96a6a75271b8',
                account: 'dcd15f97-9b44-4e4b-8a2e-b87313a43d73.9c164c67-cc6d-424b-add5-8783a417e282.123456789',
                amount: '10',
                data: '',
                noteToSelf: {},
                executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
                expiresAt: '2016-05-18T12:00:00.000Z'
            };

            return assert.eventually.equal(this.plugin.sendTransfer(transferRequest), null);
        });

        it ('should fire outgoing prepare event', (next) => {
            let transfer = Object.assign({}, testTransfer, {
                sending_address: testTransfer.receiving_address,
                receiving_address: testTransfer.sending_address
            });

            this.plugin.on('outgoing_prepare', (transferEvent) => {
                assert.equal(transferEvent.id, transfer.uuid);
                assert.equal(transferEvent.account, `${opts.ledger.gatewayUuid}.${opts.ledger.vaultUuid}.${testTransfer.sending_address}`);
                next();
            });

            this.wsMock.send(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                method: 'transfer.create',
                data: transfer
            }));
        });

        it ('should get fulfilment for transfer', () => {
            this.ilpMock.get('/transfers/u123').replyWithFile(200, __dirname + '/mocks/transfer1.json');

            return assert.eventually.equal(this.plugin.getFulfillment('u123'), "ff:0:3:123123123");
        });

        it ('should fire MissingFulfillmentError on missing fulifillment', () => {
            this.ilpMock.get('/transfers/t123').replyWithFile(200, __dirname + '/mocks/transferFulfillment1.json');

            return assert.isRejected(this.plugin.getFulfillment('t123'), Error.MissingFulfillmentError);
        });

    });


});
