'use strict';
require('array.prototype.find');

function _module(config) {

    if ( !(this instanceof _module) ){
        return new _module(config);
    }

    const redis = require('redis');
    var moment = require('moment');

    let pub = redis.createClient(
        {
            host: process.env.REDIS || global.config.redis || '127.0.0.1' ,
            socket_keepalive: true,
            retry_unfulfilled_commands: true
        }
    );

    pub.on('end', function(e){
        console.log('Redis hung up, committing suicide');
        process.exit(1);
    });

    var NodeCache = require( "node-cache" );

    var deviceCache = new NodeCache();
    var statusCache = new NodeCache();

    var merge = require('deepmerge');

    var request = require('request');
    var https = require('https');
    var keepAliveAgent = new https.Agent({ keepAlive: true });
/*
    require('request').debug = true
    require('request-debug')(request);
*/

    deviceCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'datetime', id : key, value : value });
        console.log( 'sentinel.device.insert => ' + data );
        pub.publish( 'sentinel.device.insert', data);
    });

    deviceCache.on( 'delete', function( key ){
        let data = JSON.stringify( { module: 'datetime', id : key });
        console.log( 'sentinel.device.delete => ' + data );
        pub.publish( 'sentinel.device.delete', data);
    });

    statusCache.on( 'set', function( key, value ){
        let data = JSON.stringify( { module: 'datetime', id : key, value : value });
        console.log( 'sentinel.device.update => ' + data );
        pub.publish( 'sentinel.device.update', data);
    });

	var that = this;

    function call(url) {

        return new Promise( (fulfill, reject) => {

            console.log(url);

            let options = {
                url : url,
                timeout : 90000,
                agent: keepAliveAgent
            };

            try {
                request(options, (err, response, body) => {
                    if (!err && response.statusCode == 200) {
                        fulfill(JSON.parse(body));
                    } else {
                        console.error(err||body);
                        reject(err||body);
                    }
                });
            }catch(e){
                console.error(err);
                reject(e);
            }
        } );
    }

    this.getDevices = () => {

        return new Promise( (fulfill, reject) => {
            deviceCache.keys( ( err, ids ) => {
                if (err)
                    return reject(err);

                deviceCache.mget( ids, (err,values) =>{
                    if (err)
                        return reject(err);

                    statusCache.mget( ids, (err, statuses) => {
                        if (err)
                            return reject(err);

                        let data = [];

                        for (let key in values) {
                            let v = values[key];

                            if ( statuses[key] ) {
                                v.current = statuses[key];
                                data.push(v);
                            }
                        }

                        fulfill(data);
                    });

                });
            });
        });
    };

    this.getDeviceStatus = (id) => {

        return new Promise( (fulfill, reject) => {
            try {
                statusCache.get(id, (err, value) => {
                    if (err)
                        return reject(err);

                    fulfill(value);
                }, true);
            }catch(err){
                reject(err);
            }
        });

    };

    function updateStatus() {
        return new Promise( ( fulfill, reject ) => {
            let d = {
                id: global.config.timer_uuid,
            };


            getNow()
                .then( (data) => {
                    statusCache.set( d.id, data );
                    fulfill();
                })
                .catch( (err) =>{
                    reject(err);
                })

        });
    }

    this.Reload = () => {
        return new Promise( (fulfill,reject) => {
            fulfill([]);
        });
    };

    let lastSunriseSunset = { date : '', data : null };

    function getNow(){

        return new Promise( (fulfill, reject) => {

            let now = moment.utc();

            let d = {
                now : now.format(),
                date : now.format('YYYY-MM-DD'),
                day :  now.format('E'),
                week :  now.format('W'),
                time : now.format('HH:mm:ss'),
                ts : now.format('X'),
            };

            if ( global.config.location ){

                if ( lastSunriseSunset.date === d.date ){
                    d['sunrise'] = lastSunriseSunset.data.results.sunrise;
                    d['sunset'] = lastSunriseSunset.data.results.sunset;
                    return fulfill(d);
                }

                let url = `https://api.sunrise-sunset.org/json?lat=${global.config.location.lat}&lng=${global.config.location.lng}&formatted=0`;

                call( url )
                    .then( (data) => {

                        lastSunriseSunset.data = data;

                        if ( data.results ) {
                            lastSunriseSunset.date = d.date;

                            d['sunrise'] = data.results.sunrise;
                            d['sunset'] = data.results.sunset;
                        }

                        return fulfill(d);
                    })
                    .catch( (err) =>{
                        reject(err);
                    });
            }else {
                fulfill(d);
            }

           // fulfill(d);
            // https://api.sunrise-sunset.org/json?lat=36.7201600&lng=-4.4203400&formatted=0

        });

    }

    function loadSystem(){

        return new Promise( ( fulfill, reject ) => {

            let devices = [];

            let d = {
                id: global.config.timer_uuid,
                name: 'timer',
                type: 'timer',
                current: {}
            };

            deviceCache.set(d.id, d);

            devices.push(d);

            getNow()
                .then( (data) => {
                    statusCache.set( d.id, data );
                    fulfill(devices);
                })
                .catch( (err) =>{
                    reject(err);
                });
        });
    }

    loadSystem()

        .then( () => {

            function pollSystem() {
                updateStatus()
                    .then(() => {
                        setTimeout(pollSystem, 1000);
                    })
                    .catch((err) => {
                        console.error(err);
                        setTimeout(pollSystem, 60000);
                    });

            }

            setTimeout(pollSystem, 1000);

        })
        .catch((err) => {
            console.error(err);
            process.exit(1);
        });

    return this;
}

module.exports = _module;