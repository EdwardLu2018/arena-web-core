/**
 * @fileoverview Goto URL Component.
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date 2020
 */

/**
 * Load new URL when object is clicked
 * @module goto-url
 * @property {string} on - A case-sensitive string representing the [event type]{@link https://developer.mozilla.org/en-US/docs/Web/Events} to listen for, e.g. 'mousedown', 'mouseup'
 * @property {string} url - The destination url e.g. https://example.com
 * @property {string} [dest=sametab] - Where to open the URL; one of 'popup', 'newtab', 'sametab'
 */
AFRAME.registerComponent('goto-url', {
    // load new URL if clicked
    schema: {
        on: {
            default: '',
        }, // event to listen 'on'
        url: {
            default: '',
        }, // http:// style url
        dest: {
            default: 'sametab',
            oneOf: ['popup', 'newtab', 'sametab'],
        }, // newtab
    },

    multiple: true,

    init() {},

    update(oldData) {
        const { data, el } = this;

        let fired = false;
        el.removeEventListener(oldData.on, this.eventHandlerFn);
        if (data.on && data.url) {
            // we have an event?
            this.eventHandlerFn = function eventHandlerFn() {
                if (!fired) {
                    fired = true;
                    Swal.fire({
                        title: `You clicked on a ${data.dest} URL!`,
                        html: `Are you sure you want to open <u>${data.url}</u>?`,
                        showCancelButton: true,
                        confirmButtonText: 'Yes',
                        reverseButtons: true,
                    }).then((result) => {
                        if (result.isConfirmed) {
                            switch (data.dest) {
                                case 'popup':
                                    window.open(data.url, 'popup', 'width=500,height=500');
                                    break;
                                case 'newtab':
                                    window.open(data.url, '_blank');
                                    break;
                                case 'sametab':
                                default:
                                    window.location.href = data.url;
                                    break;
                            }
                        }
                    });
                    window.setTimeout(() => {
                        // prevents event from firing twice after one event
                        fired = false;
                    }, 100);
                }
            };
            el.addEventListener(data.on, this.eventHandlerFn);
        } else {
            // `event` not specified, just log the message.
            console.debug(data);
        }
    },

    // handle component removal
    remove() {
        const { data, el } = this;

        // remove event listener
        if (data.on) {
            el.removeEventListener(data.on, this.eventHandlerFn);
        }
    },
});
