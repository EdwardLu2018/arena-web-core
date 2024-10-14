/**
 * @fileoverview Perform periodic pings on MQTT to monitor network latency
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2023, The CONIX Research Center. All rights reserved.
 * @date 2023
 */

import { ARENA_EVENTS } from '../../constants';

const Paho = require('paho-mqtt'); // https://www.npmjs.com/package/paho-mqtt

/**
 * Publish with qos of 2 for network graph to update latency
 * @module network-latency
 * @property {number} UPDATE_INTERVAL_MS=10000 - Interval to send the periodic pings (ms)
 *
 */
AFRAME.registerComponent('network-latency', {
    schema: {
        enabled: { type: 'boolean', default: true },
        updateIntervalMs: { type: 'number', default: 10000 }, // updates every 10s
        latencyTopic: { type: 'string', default: ARENA.defaults.latencyTopic },
    },

    init() {
        this.isReady = false;
        ARENA.events.addEventListener(ARENA_EVENTS.MQTT_LOADED, this.ready.bind(this));
    },
    ready() {
        const { data, el } = this;

        const { sceneEl } = el;

        this.mqtt = sceneEl.systems['arena-mqtt'];

        const pahoMsg = new Paho.Message('{ "type": "latency" }'); // send message type latency
        pahoMsg.destinationName = data.latencyTopic;
        pahoMsg.qos = 2;

        this.pahoMsg = pahoMsg;
        this.message = '{ "type": "latency" }'; // send message type latency
        this.topic = data.latencyTopic;
        this.qos = 2;

        this.tick = AFRAME.utils.throttleTick(this.tick, data.updateIntervalMs, this);
        this.isReady = true;
    },

    tick() {
        if (!this.isReady || !this.enabled) return;

        // publish empty message with qos of 2 for network graph to update latency
        if (ARENA.events.eventData[ARENA_EVENTS.MQTT_LOADED] && this.mqtt.isConnected()) {
            this.mqtt.publish(this.topic, this.message, this.qos);
        }
    },
});
