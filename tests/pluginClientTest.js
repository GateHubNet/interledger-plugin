"use strict";

var Plugin = require('../index');
const debug = require('debug')('client');

let plugin = Plugin({
    ledger: {
        gatewayUuid: 'dcd15f97-9b44-4e4b-8a2e-b87313a43d73',
        vaultUuid: '9c164c67-cc6d-424b-add5-8783a417e282',
        hostUrl: 'localhost:8080',
        notificationsUrl: '/notifications'
    },
    user: {
        uuid: '5f059a8b-3921-5085-50c5-0250245b49b5',
        wallet: '69063371'
    }
});


plugin.connect()
    .then(() => {
        debug('sending message');

        setTimeout(() => {
        plugin.sendMessage({
            account: '5f059a8b-3921-5085-50c5-0250245b49b5',
            ledger: '',
            data: {
                source_amount: "100.25",
                source_address: "example.eur-ledger.alice",
                destination_address: "example.usd-ledger.bob",
                source_expiry_duration: "6000",
                destination_expiry_duration: "5"
            }
        });

        plugin.on('incoming_message', (data) => {
            debug('received incomming_message event', data);
        });

        }, 2000);

    });
