import { TOPICS } from '../../constants';
import { ARENAUtils } from '../../utils';

/**
 * @fileoverview Component to listen for mouse events and publish corresponding events
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date 2020
 */

/**
 * Keep track of mouse events and publish corresponding events
 * @module click-listener
 */
AFRAME.registerComponent('click-listener', {
    schema: {
        bubble: { type: 'boolean', default: true },
        enabled: { type: 'boolean', default: true },
        default: true,
    },

    init() {
        this.cameraPos = document.getElementById('my-camera').components['arena-camera']?.position;
        const { topicParams } = ARENA;
        this.topicBase = TOPICS.PUBLISH.SCENE_USER.formatStr(topicParams);
        this.topicBasePrivate = TOPICS.PUBLISH.SCENE_USER_PRIVATE.formatStr(topicParams);
        this.topicBasePrivateProg = TOPICS.PUBLISH.SCENE_PROGRAM_PRIVATE.formatStr(topicParams);

        this.mousedownHandler = (evt) => {
            this.mouseEvtHandler(evt, 'mousedown');
        };
        this.mouseupHandler = (evt) => {
            this.mouseEvtHandler(evt, 'mouseup');
        };
        this.mouseenterHandler = (evt) => {
            this.mouseEvtHandler(evt, 'mouseenter');
        };
        this.mouseleaveHandler = (evt) => {
            this.mouseEvtHandler(evt, 'mouseleave');
        };
    },

    update(oldData) {
        if (this.data && !oldData) {
            this.registerListeners();
        } else if (!this.data && oldData) {
            this.unregisterListeners();
        }
    },
    remove() {
        this.unregisterListeners();
    },
    registerListeners() {
        this.el.addEventListener('mousedown', this.mousedownHandler);
        this.el.addEventListener('mouseup', this.mouseupHandler);
        this.el.addEventListener('mouseenter', this.mouseenterHandler);
        this.el.addEventListener('mouseleave', this.mouseleaveHandler);
    },
    unregisterListeners() {
        this.el.removeEventListener('mousedown', this.mousedownHandler);
        this.el.removeEventListener('mouseup', this.mouseupHandler);
        this.el.removeEventListener('mouseenter', this.mouseenterHandler);
        this.el.removeEventListener('mouseleave', this.mouseleaveHandler);
    },
    mouseEvtHandler(evt, evtType) {
        const { el, topicBase, topicBasePrivate, topicBasePrivateProg } = this;
        if (this.data.bubble === false) {
            evt.stopPropagation();
        }
        if (this.data.enabled === false) return;

        if (!this.cameraPos) {
            this.cameraPos = document.getElementById('my-camera').components['arena-camera']?.position;
        }
        const clickPos = ARENAUtils.vec3ToObject(this.cameraPos);
        const coordsData = ARENAUtils.setClickData(evt);

        if ('cursorEl' in evt.detail) {
            // original click event; simply publish to MQTT
            const thisMsg = {
                object_id: ARENA.idTag,
                action: 'clientEvent',
                type: evtType,
                data: {
                    originPosition: clickPos,
                    targetPosition: coordsData,
                    target: this.el.id,
                },
            };
            if (!this.el.getAttribute('goto-url') && !this.el.getAttribute('textinput')) {
                // publishing events attached to user id objects allows sculpting security
                ARENAUtils.publishClientEvent(el, thisMsg, topicBase, topicBasePrivate, topicBasePrivateProg);
            }
        }
    },
});
