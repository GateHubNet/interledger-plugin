"use strict";


const mockSocket = require('./mocks/mockSocket');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const nock = require('nock');
const mock = require('mock-require');
const Error = require('../errors');
const Account = require('../Account');

mock('ws', mockSocket.WebSocket);

const Plugin = require('../index');

chai.use(chaiAsPromised);
let assert = chai.assert;
let plugin = null;

const opts = {
    urls: {
        ilpUrl: 'http://ilp.local',
        coreUrl: 'http://core.local/v1',
        notificationsUrl: '/notifications'
    },
    account: 'g1.v1.u1.w1'
};

const account = Account('g1.v1.u1.w1');

let testTransfer = {
    uuid: 'd86b0299-e2fa-4713-833a-96a6a75271b8',
    amount: '100',
    sending_address: '11111111',
    receiving_address: account.getWallet(),
    data: {},
    state: 'prepared',
    execution_condition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
    expires_at: '2016-05-18T12:00:00.000Z'
};


describe('Interledger Plugin', () => {

    beforeEach(next => {
        this.plugin = Plugin(opts);

        this.ilpMock = nock(opts.urls.ilpUrl);
        this.coreMock = nock(opts.urls.coreUrl);
        this.wsMock = mockSocket.makeServer(opts.urls.ilpUrl.replace('http', 'ws') + opts.urls.notificationsUrl);

        this.plugin.once('connect', () => next());
        this.plugin.connect();
    });

    afterEach(() => {
        this.wsMock.stop();
        this.plugin.disconnect();
    });

    describe ('Info', () => {

        it ('should connect and return promise', () => {
            this.plugin = Plugin(opts);
            return assert.eventually.equal(this.plugin.connect(), null);
        });

        it ('should be connected', () => {
            return assert.equal(this.plugin.isConnected(), true);
        });

        it ('should get account', () => {
            return assert.eventually.equal(this.plugin.getAccount(), account.toString())
        });

        it ('should get prefix', () => {
            return assert.eventually.equal(this.plugin.getPrefix(), "g1.v1.");
        });

        it ('should get ledger precision and scale', () => {
            this.ilpMock.get(`/gateways/${account.getGateway()}/vaults/${account.getVault()}`)
                .replyWithFile(200, __dirname + '/mocks/info1.json');

            return assert.eventually.deepEqual(this.plugin.getInfo(), require('./mocks/info1.json'));
        });

        it ('should get account balance', () => {
            this.coreMock.get(`/wallets/${account.getWallet()}/balances`)
                .replyWithFile(200, __dirname + '/mocks/balance1.json');

            return assert.eventually.equal(this.plugin.getBalance(), "98452");
        });

        it ('should disconnect the plugin', (next) => {
            this.plugin.once('disconnect', () => next());

            return assert.eventually.equal(this.plugin.disconnect(), null);
        });

    });


    describe ('Messages', () => {
        it ('should send message', next => {
            this.ilpMock.post('/messages').reply(200, (uri, msg) => {
                assert.equal(msg.from, 'g1.v1.u1.w1');
                assert.equal(msg.to, 'g1.v1.u2.w2');
                next();
            });

            let data = {
                ledger: 'g1.v1',
                account: 'g1.v1.u2.w2',
                data: {
                    source_amount: "100.25",
                    source_address: "g2.v2.u2",
                    destination_address: "g1.v1.u1",
                    source_expiry_duration: "6000",
                    destination_expiry_duration: "5"
                }
            };

            this.plugin.sendMessage(data);
        });


        it ('should notify plugin for message', next => {
            this.ilpMock.post('/messages').reply(200);

            let data = {
                ledger: 'g1.v1',
                account: 'g1.v1.u1',
                from: 'g1.v1.u1',
                to: 'g1.v1.u2',
                source_amount: "100.25",
                source_address: "g2.v2.u2",
                destination_address: "g1.v1.u1",
                source_expiry_duration: "6000",
                destination_expiry_duration: "5"
            };

            this.plugin.once('incoming_message', message => {
                assert.deepEqual(data, message);
                next();
            });

            this.plugin.sendMessage({ account: 'g1.v1.u1.w1', ledger: 'g1.v1', data: data }).then(() => {
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

        it ('should make transfer', (next) => {
            const transferRequest = {
                id: 'd86b0299-e2fa-4713-833a-96a6a75271b8',
                account: 'dcd15f97-9b44-4e4b-8a2e-b87313a43d73.9c164c67-cc6d-424b-add5-8783a417e282.u1223.123456789',
                amount: '10',
                data: '',
                noteToSelf: {},
                executionCondition: 'cc:0:3:47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU:0',
                expiresAt: '2016-05-18T12:00:00.000Z'
            };

            this.ilpMock.post('/transfers').reply(200, (url, data) => {
                assert.deepEqual(data, {
                    uuid: transferRequest.id,
                    sending_user_uuid: account.getUser(),
                    sending_address: account.getWallet(),
                    receiving_address: Account(transferRequest.account).getWallet(),
                    vault_uuid: account.getVault(),
                    amount: transferRequest.amount,
                    data: transferRequest.data,
                    note: transferRequest.noteToSelf,
                    condition: transferRequest.executionCondition,
                    expires_at: transferRequest.expiresAt
                });
                next();
            });

            this.plugin.sendTransfer(transferRequest);
        });

        it ('should fulfill transfer', () => {
            this.ilpMock.put('/transfers/u123').reply(200);
            return assert.eventually.equal(this.plugin.fulfillCondition('u123', 'ff'), null);
        });

        it ('should reject transfer', () => {
            this.ilpMock.put('/transfers/u123').reply(200);
            return assert.eventually.equal(this.plugin.rejectIncommingTransfer('u123', 'ff'), null);
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

    describe ('Transfer events', () => {
        it ('should fire outgoing prepare event', (next) => {
            let transfer = Object.assign({}, testTransfer, {
                sending_address: testTransfer.receiving_address,
                receiving_address: testTransfer.sending_address
            });

            this.plugin.once('outgoing_prepare', (transferEvent) => {
                assert.equal(transferEvent.id, transfer.uuid);
                assert.equal(transferEvent.account, `${account.getGateway()}.${account.getVault()}.${account.getUser()}.${testTransfer.sending_address}`);
                next();
            });

            this.wsMock.send(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                method: 'transfer.create',
                data: transfer
            }));
        });
    });


});
