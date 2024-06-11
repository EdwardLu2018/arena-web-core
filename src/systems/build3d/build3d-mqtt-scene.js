/**
 * @fileoverview Create an observer to listen for changes made locally in the A-Frame Inspector and publish them to MQTT.
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2020, The CONIX Research Center. All rights reserved.
 * @date 2020
 */

/* global AFRAME, ARENA, ARENAAUTH, $ */

/**
 * Create an observer to listen for changes made locally in the A-Frame Inspector and publish them to MQTT.
 * @module build3d-mqtt-scene
 */
let toolbarName = 'translate';

// register component actions
const B3DACTIONS = {
    JSON_EDIT: 'edit-json',
    FS_UPLOAD: 'upload-to-filestore',
};
const arenaComponentActions = {
    'build3d-mqtt-object': { action: B3DACTIONS.JSON_EDIT, label: 'Edit Json', icon: 'fa-code' },
};
Object.keys(ARENAAUTH.filestoreUploadSchema).forEach((props) => {
    arenaComponentActions[props] = {
        action: B3DACTIONS.FS_UPLOAD,
        label: 'Upload to Filestore',
        icon: 'fa-upload',
    };
});

function updateMqttWidth() {
    const inspectorMqttLogWrap = document.getElementById('inspectorMqttLogWrap');
    const entire = window.innerWidth;
    const left = document.getElementById('scenegraph').clientWidth;
    const right = document.getElementById('rightPanel').clientWidth;
    const correct = entire - left - right;
    inspectorMqttLogWrap.style.width = `${correct}px`;
}

function publishUploadedFile(newObj) {
    if (newObj) {
        console.log('publishing:', newObj.action, newObj);
        ARENA.Mqtt.publish(`${ARENA.outputTopic}${newObj.object_id}`, newObj);
        AFRAME.INSPECTOR.selectEntity(AFRAME.INSPECTOR.selectedEntity);
    }
}

async function handleComponentUploadAction(selectedEntity, componentName) {
    const oldObj = {
        object_id: selectedEntity.id,
        action: 'update',
        type: 'object',
        persist: true,
        data: {}, // preliminary
    };
    // merge only, leave as much of original wire format as possible, including object_type
    const srcs = ARENAAUTH.filestoreUploadSchema[componentName];
    if (srcs[0]) {
        if (srcs[0].startsWith(`${componentName}.`)) {
            // sub-component, test for geometry, if needed
            oldObj.data[componentName] = {};
            if ('geometry' in selectedEntity.components) {
                oldObj.data.object_type = selectedEntity.components.geometry.primitive;
            }
        } else {
            // high-level wire object component
            oldObj.data.object_type = componentName;
        }
    }
    const newObj = await ARENAAUTH.uploadFileStoreDialog(
        ARENA.sceneName,
        oldObj.data.object_type,
        oldObj,
        publishUploadedFile
    );
}

function addComponentAction(componentName, dataAction, title, iconName) {
    const thetitle = $(`.component .componentHeader .componentTitle[title="${componentName}"]`);
    const thebutton = $(thetitle).siblings(`.componentHeaderActions`).find(`[data-action="${dataAction}"]`);

    // does the graph have a new component?
    // insert the upload link and and action listener
    if (thetitle.length > 0 && thebutton.length === 0) {
        const buttonId = `${componentName}-${dataAction}`;
        const actionButton = document.createElement('a');
        actionButton.id = buttonId;
        actionButton.title = title;
        actionButton.classList.add('button', 'fa', iconName);
        actionButton.dataset.action = dataAction;
        actionButton.dataset.component = componentName;
        actionButton.addEventListener(
            'click',
            async (e) => {
                const { selectedEntity } = AFRAME.INSPECTOR;
                switch (dataAction) {
                    case B3DACTIONS.JSON_EDIT:
                        window.open(
                            `/build/?scene=${ARENA.namespacedScene}&objectId=${selectedEntity.id}`,
                            'ArenaJsonEditor'
                        );
                        break;
                    case B3DACTIONS.FS_UPLOAD: {
                        await handleComponentUploadAction(selectedEntity, componentName);
                        break;
                    }
                    default:
                        console.error(`Build3d data-action '${dataAction}' unsupported!`);
                        break;
                }
            },
            false
        );
        thetitle.siblings('.componentHeaderActions').prepend(actionButton);
    }
}

AFRAME.registerComponent('build3d-mqtt-scene', {
    // create an observer to listen for changes made locally in the a-frame inspector and publish them to mqtt.
    schema: {
        sceneOptionsObject: {
            type: 'string',
            default: 'scene-options',
        },
    },
    // TODO: reduce logging to a reasonable level, similar to build page
    multiple: false,
    init() {
        const observer = new MutationObserver(this.sceneNodesUpdate);
        console.log('build3d watching scene children...');
        observer.observe(this.el, {
            childList: true,
            subtree: true,
        });

        // TODO (mwfarb): possible better selector? AFRAME.INSPECTOR.selectEntity(document.getElementById('env'));

        this.tick = AFRAME.utils.throttleTick(this.tick, 1000, this);
    },
    sceneNodesUpdate(mutationList, observer) {
        mutationList.forEach((mutation) => {
            switch (mutation.type) {
                case 'childList':
                    if (mutation.addedNodes.length > 0) {
                        console.log(`${mutation.addedNodes.length} child nodes have been added.`, mutation.addedNodes);
                        mutation.addedNodes.forEach((node) => {
                            console.log('add node:', node.nodeName, node.components);
                            // new blank entities are added by the user in the inspector
                            if (
                                node.nodeName.toLowerCase() === 'a-entity' &&
                                Object.keys(node.components).length === 0
                            ) {
                                console.log('add build3d-mqtt-object:');
                                node.setAttribute('build3d-mqtt-object', 'enabled', true);
                            }
                        });
                    }
                    if (mutation.removedNodes.length > 0) {
                        console.log(
                            `${mutation.removedNodes.length} child nodes have been removed.`,
                            mutation.removedNodes
                        );
                        mutation.removedNodes.forEach((node) => {
                            console.log('delete node:', node.nodeName, node.components);
                        });
                    }
                    break;
                default:
                // skip
            }
        });
    },
    cursorAttributesUpdate(mutationList, observer) {
        mutationList.forEach((mutation) => {
            switch (mutation.type) {
                case 'attributes':
                    console.log(
                        `The ${mutation.attributeName} attribute was modified.`,
                        mutation.target.id,
                        mutation.oldValue
                    );
                    // TODO (mwfarb): we are writing to DOM too frequently, try diffing a change graph...
                    if (mutation.attributeName === 'class') {
                        if (mutation.target.className.includes('a-mouse-cursor-hover')) {
                            // flush selected attr to dom from grab cursor update
                            const el = AFRAME.INSPECTOR.selectedEntity;
                            if (el) {
                                console.log('toolbar flush', el.id, toolbarName);
                                switch (toolbarName) {
                                    case 'translate':
                                        el.setAttribute('position', el.getAttribute('position'));
                                        AFRAME.INSPECTOR.selectedEntity.components.position.flushToDOM();
                                        break;
                                    case 'rotate':
                                        el.setAttribute('rotation', el.getAttribute('rotation'));
                                        AFRAME.INSPECTOR.selectedEntity.components.rotation.flushToDOM();
                                        break;
                                    case 'scale':
                                        el.setAttribute('scale', el.getAttribute('scale'));
                                        AFRAME.INSPECTOR.selectedEntity.components.scale.flushToDOM();
                                        break;
                                    default:
                                    // skip
                                }
                            }
                        }
                    }
                    break;
                default:
                // skip
            }
        });
    },
    transformToolbarUpdate(mutationList, observer) {
        mutationList.forEach((mutation) => {
            switch (mutation.type) {
                case 'attributes':
                    console.log(
                        `The ${mutation.attributeName} attribute was modified.`,
                        mutation.target.id,
                        mutation.oldValue
                    );
                    if (mutation.attributeName === 'class') {
                        if (mutation.target.classList.contains('active')) {
                            toolbarName = mutation.target.title;
                            console.log('toolbarName', toolbarName);
                        }
                    }
                    break;
                default:
                // skip
            }
        });
    },
    tick() {
        if (!this.scenegraphDiv) {
            // this.scenegraphDiv = document.getElementById('scenegraph');
            // this.scenegraphDiv = document.getElementById('inspectorContainer');
            this.scenegraphDiv = document.getElementById('viewportBar');
            if (this.scenegraphDiv) {
                // container
                const inspectorMqttLogWrap = document.createElement('div');
                inspectorMqttLogWrap.id = 'inspectorMqttLogWrap';
                inspectorMqttLogWrap.tabIndex = 2;
                inspectorMqttLogWrap.style.width = '-webkit-fill-available';
                inspectorMqttLogWrap.style.bottom = '0';
                inspectorMqttLogWrap.style.position = 'fixed';
                inspectorMqttLogWrap.style.height = '25%';
                inspectorMqttLogWrap.style.display = 'flex';
                inspectorMqttLogWrap.style.flexDirection = 'column';
                this.scenegraphDiv.appendChild(inspectorMqttLogWrap);
                // update width as needed
                const rightPanel = document.getElementById('rightPanel');
                const resizeObserver = new ResizeObserver((entries) => {
                    updateMqttWidth();
                });
                resizeObserver.observe(rightPanel);
                window.onresize = updateMqttWidth;

                // title
                const inspectorMqttTitle = document.createElement('span');
                inspectorMqttTitle.id = 'inspectorMqttTitle';
                inspectorMqttTitle.style.backgroundColor = 'darkgreen';
                inspectorMqttTitle.style.color = 'white';
                inspectorMqttTitle.style.opacity = '.75';
                inspectorMqttTitle.style.width = '100%';
                inspectorMqttTitle.style.paddingLeft = '10px';
                inspectorMqttTitle.textContent = `ARENA's Build3D MQTT Publish Log (user: ${ARENAAUTH.user_username})`;
                inspectorMqttLogWrap.appendChild(inspectorMqttTitle);
                // TODO (mwfarb): add open close chevrons for log window in title fa-chevron-up fa-chevron-down

                // log
                const inspectorMqttLog = document.createElement('div');
                inspectorMqttLog.id = 'inspectorMqttLog';
                inspectorMqttLog.style.overflowY = 'auto';
                inspectorMqttLog.style.width = '100%';
                inspectorMqttLog.style.height = '100%';
                inspectorMqttLog.style.backgroundColor = '#242424';
                inspectorMqttLog.style.color = 'c3c3c3';
                inspectorMqttLog.style.opacity = '.75';
                inspectorMqttLog.style.paddingLeft = '10px';
                inspectorMqttLog.style.fontFamily = 'monospace,monospace';
                inspectorMqttLog.style.fontSize = '10px';
                inspectorMqttLogWrap.appendChild(inspectorMqttLog);

                const line = document.createElement('span');
                line.innerHTML += `Watching for local changes...`;
                inspectorMqttLog.appendChild(document.createElement('br'));
                inspectorMqttLog.appendChild(line);
            }
        }
        if (!this.components) {
            if (document.getElementsByClassName('components').length > 0) {
                // eslint-disable-next-line prefer-destructuring
                this.components = document.getElementsByClassName('components')[0];
                if (this.components) {
                    // TODO (mwfarb): listening for Inspector's own emitted events 'entityselect' or 'componentadd' would be ideal

                    // handle selected entity
                    const observer = new MutationObserver((mutationList) => {
                        mutationList.forEach((mutation) => {
                            // handle class change

                            // query active components
                            Object.keys(arenaComponentActions).forEach((key) => {
                                addComponentAction(
                                    key,
                                    arenaComponentActions[key].action,
                                    arenaComponentActions[key].label,
                                    arenaComponentActions[key].icon
                                );
                            });
                        });
                    });
                    const options = {
                        attributeFilter: ['class'],
                        childList: true,
                        subtree: true,
                    };
                    observer.observe(this.components, options);
                }
            }
        }
        if (!this.cursor) {
            if (document.getElementsByClassName('a-grab-cursor').length > 0) {
                // eslint-disable-next-line prefer-destructuring
                this.cursor = document.getElementsByClassName('a-grab-cursor')[0];
                if (this.cursor) {
                    // watch for mouse down use of grab tools
                    const observer = new MutationObserver(this.cursorAttributesUpdate);
                    console.log('build3d watching cursor class attributes...');
                    observer.observe(this.cursor, {
                        attributeFilter: ['class'],
                        attributes: true,
                        attributeOldValue: true,
                    });
                }
            }
        }
        // TODO (mwfarb): fix transformToolbar, is usually late and gets clipped from the global pause()
        if (!this.transformToolbar) {
            if (document.getElementsByClassName('toolbarButtons').length > 0) {
                // eslint-disable-next-line prefer-destructuring
                this.transformToolbar = document.getElementsByClassName('toolbarButtons')[0];
                if (this.transformToolbar) {
                    // watch for active toolbar grab tool change
                    const observer = new MutationObserver(this.transformToolbarUpdate);
                    console.log('build3d watching toolbar class attributes...');
                    observer.observe(this.transformToolbar, {
                        attributeFilter: ['class'],
                        attributes: true,
                        subtree: true,
                    });
                }
            }
        }
        if (!this.env) {
            this.env = document.getElementById('env');
            if (this.env) {
                this.env.setAttribute('build3d-mqtt-object', 'enabled', true);
            }
        }
    },
});
