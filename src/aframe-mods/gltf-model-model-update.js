/**
 * @fileoverview Apply any modelUpdate data attributes after a gltf model is loaded
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2023, The CONIX Research Center. All rights reserved.
 * @date 2023
 */

import { ARENAUtils } from '../utils';

// AFRAME Monkeypatch (src/components/gltf-model.js)
AFRAME.components['gltf-model'].Component.prototype.init = function init() {
    const self = this;
    const dracoLoader = this.system.getDRACOLoader();
    const meshoptDecoder = this.system.getMeshoptDecoder();
    const ktxLoader = this.system.getKTX2Loader();
    this.model = null;
    this.loader = new THREE.GLTFLoader();
    if (dracoLoader) {
        this.loader.setDRACOLoader(dracoLoader);
    }
    if (meshoptDecoder) {
        this.ready = meshoptDecoder.then((_meshoptDecoder) => {
            self.loader.setMeshoptDecoder(_meshoptDecoder);
        });
    } else {
        this.ready = Promise.resolve();
    }
    if (ktxLoader) {
        this.loader.setKTX2Loader(ktxLoader);
    }
    // Add event listener for model-loaded event
    this.el.addEventListener('model-loaded', () => {
        // Check for modelUpdate stashed prop
        const modelUpdate = self.el.deferredModelUpdate;
        if (modelUpdate) {
            // Apply modelUpdate data attributes
            ARENAUtils.updateModelComponents(self.el.object3D, modelUpdate);
            delete self.el.deferredModelUpdate;
        }
    });
};
