/**
 * @fileoverview AFRAME AABB collider component
 *
 * Open source software under the terms in /LICENSE
 * Copyright (c) 2023, The CONIX Research Center. All rights reserved.
 * @date 2023
 */

import { ARENAUtils } from '../utils';
import { TOPICS } from '../constants';

if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

// Configuration for the MutationObserver used to refresh the whitelist.
// Listens for addition/removal of elements and attributes within the scene.
const OBSERVER_CONFIG = {
    childList: true,
    attributes: true,
    subtree: true,
};

function copyArray(dest, source) {
    /* eslint-disable no-param-reassign */
    dest.length = 0;
    for (let i = 0; i < source.length; i++) {
        dest[i] = source[i];
    }
    /* eslint-disable no-param-reassign */
}

/**
 * Supermedium/aabb-collider#24a9d3e. Renamed to box-collider for clarity
 *
 * Implement AABB collision detection for entities with a mesh.
 * https://en.wikipedia.org/wiki/Minimum_bounding_box#Axis-aligned_minimum_bounding_box
 *
 * @property {string} objects - Selector of entities to test for collision.
 */
AFRAME.registerComponent('box-collider', {
    schema: {
        collideNonVisible: { default: false },
        debug: { default: false },
        enabled: { default: true },
        interval: { default: 100 }, // Change to match default camera tick rate
        objects: { default: '[box-collision-listener]' }, // Default only intersects with collision-listeners
    },

    init() {
        this.centerDifferenceVec3 = new THREE.Vector3();
        this.clearedIntersectedEls = [];
        this.closestIntersectedEl = null;
        this.boundingBox = new THREE.Box3();
        this.boxCenter = new THREE.Vector3();
        this.boxHelper = new THREE.BoxHelper();
        this.boxMax = new THREE.Vector3();
        this.boxMin = new THREE.Vector3();
        this.hitClosestClearEventDetail = {};
        this.hitClosestEventDetail = {};
        this.intersectedEls = [];
        this.objectEls = [];
        this.newIntersectedEls = [];
        this.prevCheckTime = undefined;
        this.previousIntersectedEls = [];

        this.setDirty = this.setDirty.bind(this);
        this.observer = new MutationObserver(this.setDirty);
        this.dirty = true;

        this.collideStartEventDetail = { intersectedEls: this.newIntersectedEls };
        this.collideEndEventDetail = { endIntersectedEls: this.clearedIntersectedEls };

        this.tempMatrixWorld = new THREE.Matrix4();
        this.tempMatrixWorldSceneCam = new THREE.Matrix4();
        this.isCamera = !!this.el.components.camera;
    },

    play() {
        this.observer.observe(this.el.sceneEl, OBSERVER_CONFIG);
        this.el.sceneEl.addEventListener('object3dset', this.setDirty);
        this.el.sceneEl.addEventListener('object3dremove', this.setDirty);
    },

    remove() {
        this.observer.disconnect();
        this.el.sceneEl.removeEventListener('object3dset', this.setDirty);
        this.el.sceneEl.removeEventListener('object3dremove', this.setDirty);
        if (this.data.debug) {
            if (this.boxHelper) {
                this.el.sceneEl.object3D.remove(this.boxHelper);
                this.boxHelper.dispose?.();
                this.boxHelper = null;
            }
            for (let i = 0; i < this.objectEls.length; i++) {
                const { boxHelper } = this.objectEls[i].object3D;
                if (boxHelper) {
                    this.el.sceneEl.object3D.remove(boxHelper);
                    this.objectEls[i].object3D.boxHelper = null;
                    boxHelper.dispose?.();
                }
            }
        }
    },

    tick(time) {
        const {
            boundingBox,
            centerDifferenceVec3,
            clearedIntersectedEls,
            el,
            intersectedEls,
            newIntersectedEls,
            objectEls,
            prevCheckTime,
            previousIntersectedEls,
        } = this;

        let closestCenterDifference;
        let newClosestEl;
        let i;

        if (!this.data.enabled) {
            return;
        }

        // Only check for intersection if interval time has passed.
        if (prevCheckTime && time - prevCheckTime < this.data.interval) {
            return;
        }
        // Update check time.
        this.prevCheckTime = time;

        if (this.dirty) {
            this.refreshObjects();
        }

        // Update the bounding box to account for rotations and position changes.
        // Workaround for matrixWorld update issue when in dual-view immersive mode after THREE r152
        if (this.isCamera && el.sceneEl.renderer.xr.enabled === true && el.sceneEl.renderer.xr.isPresenting === true) {
            this.tempMatrixWorld.copy(el.object3D.matrixWorld);
            this.tempMatrixWorldSceneCam.copy(el.sceneEl.camera.matrixWorld);
        }
        boundingBox.setFromObject(el.object3D);
        if (this.isCamera && el.sceneEl.renderer.xr.enabled === true && el.sceneEl.renderer.xr.isPresenting === true) {
            el.object3D.matrixWorld.copy(this.tempMatrixWorld);
            el.sceneEl.camera.matrixWorld.copy(this.tempMatrixWorldSceneCam);
        }
        this.boxMin.copy(boundingBox.min);
        this.boxMax.copy(boundingBox.max);
        boundingBox.getCenter(this.boxCenter);

        if (this.data.debug) {
            this.boxHelper.setFromObject(el.object3D);
            if (!this.boxHelper.parent) {
                el.sceneEl.object3D.add(this.boxHelper);
            }
        }

        copyArray(previousIntersectedEls, intersectedEls);

        // Populate intersectedEls array.
        /* eslint-disable no-continue */
        intersectedEls.length = 0;
        for (i = 0; i < objectEls.length; i++) {
            if (objectEls[i] === this.el) {
                continue;
            }
            // Make sure box-collision-listener is enabled
            if (objectEls[i].getAttribute('box-collision-listener').enabled === false) {
                continue;
            }

            // Don't collide with non-visible if flag set.
            if (!this.data.collideNonVisible && !objectEls[i].getAttribute('visible')) {
                // Remove box helper if debug flag set and has box helper.
                if (this.data.debug) {
                    const { boxHelper } = objectEls[i].object3D;
                    if (boxHelper) {
                        el.sceneEl.object3D.remove(boxHelper);
                        objectEls[i].object3D.boxHelper = null;
                        boxHelper?.dispose();
                    }
                }
                continue;
            }

            // Check for interection.
            if (this.isIntersecting(objectEls[i])) {
                intersectedEls.push(objectEls[i]);
            }
        }
        /* eslint-disable no-continue */

        // Get newly intersected entities.
        newIntersectedEls.length = 0;
        for (i = 0; i < intersectedEls.length; i++) {
            if (previousIntersectedEls.indexOf(intersectedEls[i]) === -1) {
                newIntersectedEls.push(intersectedEls[i]);
            }
        }

        // Emit cleared events on no longer intersected entities.
        clearedIntersectedEls.length = 0;
        for (i = 0; i < previousIntersectedEls.length; i++) {
            if (intersectedEls.indexOf(previousIntersectedEls[i]) !== -1) {
                continue;
            }
            if (!previousIntersectedEls[i].hasAttribute('box-collider')) {
                previousIntersectedEls[i].emit('box-collide-end');
            }
            clearedIntersectedEls.push(previousIntersectedEls[i]);
        }

        // Emit events on intersected entities. Do this after the cleared events.
        for (i = 0; i < newIntersectedEls.length; i++) {
            if (newIntersectedEls[i] === this.el) {
                continue;
            }
            if (newIntersectedEls[i].hasAttribute('box-collider')) {
                continue;
            }
            newIntersectedEls[i].emit('box-collide-start');
        }

        // Calculate closest intersected entity based on centers.
        for (i = 0; i < intersectedEls.length; i++) {
            if (intersectedEls[i] === this.el) {
                continue;
            }
            centerDifferenceVec3.copy(intersectedEls[i].object3D.boundingBoxCenter).sub(this.boxCenter);
            if (closestCenterDifference === undefined || centerDifferenceVec3.length() < closestCenterDifference) {
                closestCenterDifference = centerDifferenceVec3.length();
                newClosestEl = intersectedEls[i];
            }
        }

        // Emit events for the new closest entity and the old closest entity.
        if (!intersectedEls.length && this.closestIntersectedEl) {
            // No intersected entities, clear any closest entity.
            this.hitClosestClearEventDetail.el = this.closestIntersectedEl;
            this.closestIntersectedEl.emit('hitclosestclear');
            this.closestIntersectedEl = null;
            el.emit('hitclosestclear', this.hitClosestClearEventDetail);
        } else if (newClosestEl !== this.closestIntersectedEl) {
            // Clear the previous closest entity.
            if (this.closestIntersectedEl) {
                this.hitClosestClearEventDetail.el = this.closestIntersectedEl;
                this.closestIntersectedEl.emit('hitclosestclear', this.hitClosestClearEventDetail);
            }
            if (newClosestEl) {
                // Emit for the new closest entity.
                newClosestEl.emit('hitclosest');
                this.closestIntersectedEl = newClosestEl;
                this.hitClosestEventDetail.el = newClosestEl;
                el.emit('hitclosest', this.hitClosestEventDetail);
            }
        }

        if (clearedIntersectedEls.length) {
            el.emit('box-collide-end', this.collideEndEventDetail);
        }

        if (newIntersectedEls.length) {
            el.emit('box-collide-start', this.collideStartEventDetail);
        }
    },

    /**
     * AABB collision detection.
     * 3D version of https://www.youtube.com/watch?v=ghqD3e37R7E
     */
    isIntersecting: (function isIntersectingFactory() {
        const boundingBox = new THREE.Box3();

        return function intersectingFn(el) {
            let box;

            // Dynamic, recalculate each tick.
            if (el.getAttribute('box-collision-listener').dynamic) {
                // Box.
                boundingBox.setFromObject(el.object3D);
                box = boundingBox;
                // Center.
                el.object3D.boundingBoxCenter = el.object3D.boundingBoxCenter || new THREE.Vector3();
                box.getCenter(el.object3D.boundingBoxCenter);
            }

            // Static, reuse box and centers.
            if (!el.getAttribute('box-collision-listener').dynamic) {
                if (!el.object3D.aabbBox) {
                    // Box.
                    el.object3D.updateWorldMatrix(true, false);
                    el.object3D.aabbBox = new THREE.Box3().setFromObject(el.object3D);
                    // Center.
                    el.object3D.boundingBoxCenter = new THREE.Vector3();
                    el.object3D.aabbBox.getCenter(el.object3D.boundingBoxCenter);
                }
                box = el.object3D.aabbBox;
            }

            if (this.data.debug) {
                if (!el.object3D.boxHelper) {
                    el.object3D.boxHelper = new THREE.BoxHelper(
                        el.object3D,
                        new THREE.Color(Math.random(), Math.random(), Math.random())
                    );
                    el.sceneEl.object3D.add(el.object3D.boxHelper);
                }
                el.object3D.boxHelper.setFromObject(el.object3D);
            }

            const boxMin = box.min;
            const boxMax = box.max;
            return (
                this.boxMin.x <= boxMax.x &&
                this.boxMax.x >= boxMin.x &&
                this.boxMin.y <= boxMax.y &&
                this.boxMax.y >= boxMin.y &&
                this.boxMin.z <= boxMax.z &&
                this.boxMax.z >= boxMin.z
            );
        };
    })(),

    /**
     * Mark the object list as dirty, to be refreshed before next raycast.
     */
    setDirty() {
        this.dirty = true;
    },

    /**
     * Update list of objects to test for intersection.
     */
    refreshObjects() {
        const { data } = this;
        // If objects not defined, intersect with everything.
        this.objectEls = data.objects ? this.el.sceneEl.querySelectorAll(data.objects) : this.el.sceneEl.children;
        this.dirty = false;
    },
});

AFRAME.registerComponent('box-collision-listener', {
    schema: {
        enabled: { default: true },
        dynamic: { default: false },
    },
    remove() {
        // Possible cleanup on box-collider?
    },
});

AFRAME.registerComponent('box-collision-publisher', {
    schema: {
        enabled: { default: true },
    },
    init() {
        const thisEl = this.el;

        thisEl.addEventListener('box-collide-start', (e) => {
            const sourceName = thisEl.id === 'my-camera' ? ARENA.idTag : thisEl.components['arena-hand'].name;
            const topicParams = {
                nameSpace: ARENA.nameSpace,
                sceneName: ARENA.sceneName,
                userObj: sourceName,
            };
            const topicBase = TOPICS.PUBLISH.SCENE_USER.formatStr(topicParams);
            const topicBasePrivate = TOPICS.PUBLISH.SCENE_USER_PRIVATE.formatStr(topicParams);
            const topicBasePrivateProg = TOPICS.PUBLISH.SCENE_PROGRAM_PRIVATE.formatStr(topicParams);
            e.detail.intersectedEls.forEach((inEl) => {
                const thisMsg = {
                    object_id: sourceName,
                    action: 'clientEvent',
                    type: 'collision-start',
                    data: {
                        target: inEl.id,
                        targetPosition: ARENAUtils.getWorldPos(inEl),
                        originPosition: ARENAUtils.getWorldPos(thisEl),
                    },
                };
                ARENAUtils.publishClientEvent(inEl, thisMsg, topicBase, topicBasePrivate, topicBasePrivateProg);
            });
        });
        thisEl.addEventListener('box-collide-end', (e) => {
            const sourceName = thisEl.id === 'my-camera' ? ARENA.idTag : thisEl.components['arena-hand'].name;
            const topicParams = {
                nameSpace: ARENA.nameSpace,
                sceneName: ARENA.sceneName,
                userObj: sourceName,
            };
            const topicBase = TOPICS.PUBLISH.SCENE_USER.formatStr(topicParams);
            const topicBasePrivate = TOPICS.PUBLISH.SCENE_USER_PRIVATE.formatStr(topicParams);
            const topicBasePrivateProg = TOPICS.PUBLISH.SCENE_PROGRAM_PRIVATE.formatStr(topicParams);
            e.detail.endIntersectedEls.forEach((inEl) => {
                const thisMsg = {
                    object_id: sourceName,
                    action: 'clientEvent',
                    type: 'collision-end',
                    data: {
                        target: inEl.id,
                        targetPosition: ARENAUtils.getWorldPos(inEl),
                        originPosition: ARENAUtils.getWorldPos(thisEl),
                    },
                };
                ARENAUtils.publishClientEvent(inEl, thisMsg, topicBase, topicBasePrivate, topicBasePrivateProg);
            });
        });
    },
});
