#! /usr/bin/node
"use strict";
var dgram = require('dgram'),
    //json = require('./sip-pnp.json'), // {"reUA": "url", ... }
    os = require('os'),
    sip = require('sip'),
    util = require('util');

try { // optional availability
    var debug = require('debug')('pnp');
} catch (ex) {
    var debug = function () {};
}

util.inspect.defaultOptions = { depth: null }; // debug full messages
module.exports = Object.assign(exports, {
    ipv4: (function externalIPv4(ifs) { // find first external IPv4 of local system
            for (var n in ifs)
                for (var i in ifs[n])
                    if (!ifs[n][i].internal && ifs[n][i].family === 'IPv4')
                        return ifs[n][i].address;
        })(os.networkInterfaces()),
    reMac: /^MAC([0-9a-f]{12})$/i, // regexp to extract {mac} from REQUEST_URI
    rstring: function rstring() { return Math.floor(Math.random()*1e6).toString(); },
    sip: sip, // convenience for when require'd into an interactive session
    pnp: dgram.createSocket({ type: 'udp4', reuseAddr: true }) // externally managed PnP socket
        .bind(5060, '224.0.1.75', function bound() {
            this.addMembership('224.0.1.75');
        }),
    //uaUrls: Object.keys(json).map(function nvMapper(reUA, idx, arr) { // consume external JSON
    //    return { reUA: new RegExp(reUA), url: json[reUA] };
    //}, json),
    uaUrls: [ // static User-Agent regexp(s) to URL mapping
        { reUA: /^Appello IT82 /,  url: "http://http.local/Config1/{mac}.cfg" },
        { reUA: /^Akuvox SP-R24 /, url: "http://http.local/Config/{mac}.cfg"  },
    ],
});

var startOptions = {
    address: exports.ipv4,
    publicAddress: exports.ipv4,
    tcp: false, // TCP transport not needed
    pnp: exports.pnp, // supply externally managed multicast socket
};
sip.start(startOptions, function request(req, info) {
    debug(global.subscribe = Object.assign({ what: 'recv', when: new Date }, req));

    // eget MAC and search for User-Agent match
    var url, mac = (sip.parseUri(req.uri).user.match(exports.reMac) || [])[1];
    for (var i in exports.uaUrls)
        if (exports.uaUrls[i].reUA.test(req.headers['user-agent'] || 'missing'))
            if (url = exports.uaUrls[i].url.replace(/\{mac\}/g, mac))
                break;

    // prepare and send the SUBSCRIBE response
    var resp = (req.method === 'SUBSCRIBE' && mac && url) ? [200, 'OK'] : [400, 'Bad Request'];
    req.res = sip.makeResponse(req, resp[0], resp[1]);
    req.res.headers.to.params.tag = exports.rstring();
    debug(Object.assign({ what: 'send', when: new Date }, req.res));
    sip.send(req.res);

    // trace reason for any failure
    if (req.method !== 'SUBSCRIBE')
        return console.log(req.method, '- not supported');
    if (!mac)
        return console.log(req.uri, '- bad URI format [sip:MACxxxxxxxxxxxx@224.0.1.75]');
    if (!url)
        return console.log(JSON.stringify(req.headers['user-agent'] || 'missing'), '- unrecognised User-Agent');

    // schedule a NOTIFY with the relevant URL
    process.nextTick(function notify() {
        // prepare NOTIFY request
        var notify = {
            method: 'NOTIFY',
            uri: 'sip:' + info.address + ':' + info.port,
            headers: {
                via: [],
                to: req.headers.from, // must match SUBSCRIBE
                from: req.headers.to, // must match SUBSCRIBE
                'call-id': exports.rstring() + '@' + exports.ipv4,
                cseq: { method: 'NOTIFY', seq: Math.floor(Math.random() * 1e5) },
                'content-type': 'application/url',
                contact: [{ uri: 'sip:' + exports.ipv4 }],
                'subscription-state': 'terminated;reason=timeout', // appears necessary
                event: req.headers.event, // appears necessary
            },
            content: url,
        };
        
        // send NOTIFY request
        console.log((new Date).toJSON(), info.address + ':' + info.port, JSON.stringify(req.headers['user-agent']), '=>', url);
        debug(global.notify = Object.assign({ what: 'send', when: new Date }, notify));
        sip.send(notify, function response(res) {
            debug(Object.assign({ what: 'recv', when: new Date }, notify.res = res));
        });
    });
});
