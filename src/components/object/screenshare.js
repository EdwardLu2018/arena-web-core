/**
 * @fileoverview Screen share System to keep track of all screenshareable objects.
 *
 */

/**
 * Screenshare-able Component. Allows an object to be screenshared upon
 * @module screenshareable
 *
 */
AFRAME.registerComponent('screenshareable', {
    schema: {},

    init() {
        this.update();
        // add a default landmark for any screen share object
        if (!this.el.hasAttribute('landmark')) {
            this.el.setAttribute(
                'landmark',
                `label: Screen: ${this.el.id} (nearby); randomRadiusMin: 2; randomRadiusMax: 3`
            );
        }
    },

    update(oldData) {
        const register = this.data;
        const prevRegistered = oldData;

        if (register) {
            this.register();
        } else if (prevRegistered) {
            this.remove();
        }
    },

    register() {
        this.system.registerComponent(this);
    },

    remove() {
        this.system.unregisterComponent(this);
    },
});
