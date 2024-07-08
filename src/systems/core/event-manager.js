/**
 * @fileoverview Manager for ARENA events, particularly those related to AFRAME
 *               and ARENA loading sequence, in which scary async things happen
 *               which results in unpredictable event ordering for various
 *               systems and components.
 */

AFRAME.registerSystem('arena-event-manager', {
    init() {
        this.eventData = {};
        ARENA.events = this; // Set ARENA reference, if this happens before ARENA ready
        this.sceneEl.addEventListener('loaded', () => {
            // Handle AFRAME scene event
            this.eventData.loaded = true;
        });
    },
    /**
     * Register event listener AND dispatch it immediately if key is already set
     * @param {string} key - event key
     * @param {function} callback - callback function to register or dispatch
     * @param {object} [opts={ once: true }] - options to pass to addEventListener
     */
    addEventListener(key, callback, opts = { once: true }) {
        this.sceneEl.addEventListener(key, callback, opts);
        if (this.eventData[key] !== undefined) {
            callback(this.eventData[key]); // Immediately fire callback
        }
    },
    /**
     * Register callback that depends on multiple event dependencies, firing
     * if all events are already set -- which may be immediate.
     * @param {array} keys - List of event keys to listen for
     * @param {function} callback - callback function to register or dispatch
     * @param {object} [opts={ once: true }] - options to pass to addEventListener
     */
    addMultiEventListener(keys, callback, opts = { once: true }) {
        const checkDepsAndEmit = (evtList) => {
            if (evtList.every(([, v]) => v !== undefined)) {
                callback(
                    evtList.reduce((obj, [key, value]) => {
                        // eslint-disable-next-line no-param-reassign
                        obj[key] = value;
                        return obj;
                    }, {})
                );
                return true;
            }
            return false;
        };
        const eventList = keys.map((key) => [key, this.eventData[key]]);
        if (checkDepsAndEmit(eventList)) {
            return; // All events already set, fire callback immediately
        }
        // Not ready yet, register callback for each pending event. eventList in closure
        const checkCallbacks = (e) => {
            // eslint-disable-next-line prefer-const
            let { type: key, detail: value } = e;
            value = value ?? true; // Default to some defined value
            eventList.find(([k]) => key === k)[1] = value; // Set value
            checkDepsAndEmit(eventList);
        };
        eventList.forEach(([key, value]) => {
            if (value === undefined) {
                this.sceneEl.addEventListener(key, checkCallbacks, opts);
            }
        });
    },
    /**
     * Wrapper for AFRAME emit that also sets key in events
     * @param {string} name - Name of event.
     * @param {object} [detail={}] - Custom data to pass as `detail` to the event.
     * @param {boolean} [bubbles=true] - Whether the event should bubble.
     */
    // eslint-disable-next-line default-param-last
    emit(name, detail = {}, bubbles) {
        this.eventData[name] = detail; // set event key with detail value
        this.sceneEl.emit(name, detail, bubbles);
    },
});
