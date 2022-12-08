/* global AFRAME */

/**
 * @fileoverview Emit model onProgress (loading) event for gltf models; save model.asset
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date 2020
 */

function checkRequest(url) {
    let check;
    const request =  new Request(url);
    const controller = new AbortController();
    const signal = controller.signal;
    fetch(request, { signal })
    .then((response) => {
        check = response.headers.get( 'Content-Length' ) || response.headers.get( 'X-File-Size' );
        console.log(check);
        controller.abort();
      console.log("Download complete", response);
    })
    return check;
}

AFRAME.components['gltf-model'].Component.prototype.update = function() {
    const self = this;
    const el = this.el;
    const src = this.data;
    if (!src) {
        return;
    }

    this.remove();

    // register with model-progress system to handle model loading events

    document.querySelector('a-scene').systems['model-progress'].registerModel(el, src);
    console.log(checkRequest(src));
    
    this.loader.load(src, function gltfLoaded(gltfModel) {
        self.model = gltfModel.scene || gltfModel.scenes[0];
        self.model.animations = gltfModel.animations;
        self.model.asset = gltfModel.asset; // save asset
        el.setObject3D('mesh', self.model);
        el.emit('model-loaded', {format: 'gltf', model: self.model});
    }, function gltfProgress(xhr) {
        el.emit('model-progress', {src: src, progress: (xhr.loaded / xhr.total * 100)});
    }, function gltfFailed(error) {
        const message = (error && error.message) ? error.message : 'Failed to load glTF model';
        console.error(message);
        el.emit('model-error', {format: 'gltf', src: src});
    });
    
};
