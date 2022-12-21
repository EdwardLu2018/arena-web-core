AFRAME.registerComponent('remote-render', {
    schema: {
        enabled: {type: 'boolean', default: false},
    },

    init: function() {
    },

    update: function(oldData) {
        // console.log('render-client', this.el.id, this.data.enabled);
        console.log(this.el.id);
        console.log(document.querySelector('a-scene').systems['model-progress']);
        if (oldData.enabled !== this.data.enabled) {
            this.el.object3D.visible = this.data.enabled && 
                        !document.querySelector('a-scene').systems['model-progress'].loadAlert.modelStatus[this.el.id];

            const remoteRender = new CustomEvent('hybrid-onremoterender', {
                detail: {
                    object_id: this.el.id,
                    remoteRendered: this.data.enabled && 
                    document.querySelector('a-scene').systems['model-progress'].loadAlert.modelStatus[this.el.id] ,
                    data: ARENA.namespacedScene,
                },
            });
            window.dispatchEvent(remoteRender);
        }
    },
});
