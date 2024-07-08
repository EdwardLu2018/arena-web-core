/**
 * @fileoverview Similar to overridden hide-on-enter-vr.js, but for VR
 */

AFRAME.components['hide-on-enter-vr'].Component.prototype.init = function init() {
    this.gltfAttributes = null;
    this.gltfLodAttributes = null;
    this.gltfLodAdvancedAttributes = null;
    const self = this;
    this.el.sceneEl.addEventListener('enter-vr', () => {
        if (self.el.sceneEl.is('vr-mode')) {
            self.el.object3D.visible = false;
            self.gltfAttributes = { ...self.el.getAttribute('gltf-model') };
            if (self.gltfAttributes) {
                self.el.removeAttribute('gtf-model');
            }
            self.gltfLodAttributes = self.el.getAttribute('gltf-model-lod');
            if (self.gltfLodAttributes?.enabled) {
                self.el.setAttribute('gltf-model-lod', 'enabled', false);
            }
            self.gltfLodAdvancedAttributes = self.el.getAttribute('gltf-lod-advanced');
            if (self.gltfLodAdvancedAttributes?.enabled) {
                self.el.setAttribute('gltf-lod-advanced', 'enabled', false);
            }
        }
    });
    this.el.sceneEl.addEventListener('exit-vr', () => {
        if (self.el.sceneEl.is('vr-mode')) {
            if (self.gltfAttributes) {
                self.setAttribute('gltf-model', self.gltfAttributes);
            }
            if (self.gltfLodAttributes) {
                self.setAttribute('gltf-model-lod', 'enabled', true);
            }
            if (self.gltfLodAdvancedAttributes) {
                self.setAttribute('gltf-lod-advanced', 'enabled', true);
            }
            self.el.object3D.visible = true;
        }
    });
};

/**
 * VR-only visibility, opposite behavior of hide-on-enter-vr. Implies that the object is not visible in other modes
 */

AFRAME.registerComponent('show-on-enter-vr', {
    init() {
        const self = this;
        self.el.object3D.visible = !!self.el.sceneEl.is('vr-mode');
        this.el.sceneEl.addEventListener('exit-vr', () => {
            if (self.el.sceneEl.is('vr-mode')) {
                self.el.object3D.visible = false;
            }
        });
        this.el.sceneEl.addEventListener('enter-vr', () => {
            if (self.el.sceneEl.is('vr-mode')) {
                self.el.object3D.visible = true;
            }
        });
    },
});
