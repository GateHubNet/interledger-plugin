"use strict";

const gatehubInternal = require('./gatehubInternal');
const request = require('request-promise');

module.exports = (urls, account, credentials) => {
    return Object.assign({}, gatehubInternal(urls, account), {
        ilpApi: request.defaults({
            baseUrl: urls.ilpUrl,
            json: true, auth: { bearer: credentials.token }
        }),
        coreApi: request.defaults({
            baseUrl: urls.coreUrl,
            json: true, auth: { bearer: credentials.token }
        })
    });
};