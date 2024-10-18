/**
 * @fileoverview Face feature detection and tracking System. Basically acts as a global
 *               object to control ARENA's face tracking feature.
 *
 */

import { FaceTracker, FaceTrackerSource } from './face-tracker.min';
import { TOPICS } from '../../constants';
import { ARENAUtils } from '../../utils';

AFRAME.registerSystem('face-tracking', {
    schema: {
        overlayColor: { default: '#ef2d5e' },
        displayBbox: { default: false },
        flipped: { default: true },
    },

    async init() {
        this.enabled = !ARENA.utils.isMobile();
        if (!this.enabled) return;

        this.width = 300;
        this.height = Math.ceil((window.screen.height / window.screen.width) * this.width);

        this.prevJSON = null;

        this.initialized = false;
        this.initializingTimer = null;
        this.running = false;

        this.overlayCanvas = null;

        const faceTrackerSource = new FaceTrackerSource({
            width: this.width,
            height: this.height,
        });
        this.faceTracker = new FaceTracker(faceTrackerSource);

        const _this = this;

        const faceTopic = TOPICS.PUBLISH.SCENE_USER.formatStr({
            nameSpace: ARENA.nameSpace,
            sceneName: ARENA.sceneName,
            userObj: ARENA.faceName,
        });

        window.addEventListener('onFaceTrackerInit', (e) => {
            const video = e.detail.source;
            video.classList.add('flip-video');
            video.classList.add('arena-corner-video');
            video.style.top = '15px';
            video.style.left = '15px';
            video.style.opacity = '0.3';
            const videoWidth = ARENA.localVideoWidth;
            const videoHeight = video.videoHeight / (video.videoWidth / videoWidth);
            video.style.height = `${videoHeight}px`;
            document.body.appendChild(video);

            console.log(faceTrackerSource);

            _this.overlayCanvas = document.createElement('canvas');
            _this.overlayCanvas.id = 'face-tracking-overlay';
            _this.overlayCanvas.style.zIndex = '9999';
            faceTrackerSource.copyDimensionsTo(_this.overlayCanvas);
            document.body.appendChild(_this.overlayCanvas);
        });

        window.addEventListener('onFaceTrackerProgress', (e) => {
            const { progress } = e.detail;
            this.writeOverlayText(`Downloading Face Model: ${progress}%`);
        });

        window.addEventListener('onFaceTrackerLoading', () => {
            let i = 0;
            if (!_this.initializingTimer) {
                _this.initializingTimer = setInterval(() => {
                    if (_this.running) {
                        this.writeOverlayText(`Initializing Face Tracking${'.'.repeat(i % 4)}`);
                        i++;
                    }
                }, 500);
            }
        });

        window.addEventListener('onFaceTrackerFeatures', (e) => {
            const { features } = e.detail;
            const { pose } = e.detail;
            const { bbox } = features;
            const { landmarks } = features;

            const valid = this.hasFace(landmarks);
            if (valid) {
                this.drawFeatures(features);
            } else {
                const overlayCtx = this.overlayCanvas.getContext('2d');
                overlayCtx.clearRect(0, 0, this.width, this.height);
            }

            const faceJSON = this.createFaceJSON(valid, landmarks, bbox, pose);
            if (faceJSON !== this.prevJSON) {
                ARENA.Mqtt.publish(faceTopic, faceJSON);
                this.prevJSON = faceJSON;
            }

            if (this.initializingTimer) {
                clearInterval(this.initializingTimer);
            }
        });
    },

    /*
     * System attribute update
     * @param {object} oldData - previous attribute values.
     */
    update() {
        // TODO: Do stuff with `this.data`...
    },

    /**
     * Writes text over the video canvas for face tracking status indications
     * @param {string} text Text to be written
     */
    writeOverlayText(text) {
        const overlayCtx = this.overlayCanvas.getContext('2d');
        overlayCtx.clearRect(0, 0, this.width, this.height);
        overlayCtx.font = '17px Arial';
        overlayCtx.textAlign = 'center';
        overlayCtx.fillStyle = this.data.overlayColor;
        overlayCtx.fillText(text, this.overlayCanvas.width / 2, this.overlayCanvas.height / 8);
    },

    /**
     * Draws a bounding box on the overlay canvas
     * @param {[]} bbox array formatted like so: [x1,y1,x2,y2]
     */
    drawBbox(bbox) {
        const overlayCtx = this.overlayCanvas.getContext('2d');

        overlayCtx.beginPath();
        overlayCtx.strokeStyle = 'blue';
        overlayCtx.lineWidth = 1.5;

        // [x1,y1,x2,y2]
        overlayCtx.moveTo(bbox.left, bbox.top);
        overlayCtx.lineTo(bbox.left, bbox.bottom);
        overlayCtx.lineTo(bbox.right, bbox.bottom);
        overlayCtx.lineTo(bbox.right, bbox.top);
        overlayCtx.lineTo(bbox.left, bbox.top);

        overlayCtx.stroke();
    },

    /**
     * Draws a polyline on the overlay canvas. Helper function for drawing face landmarks
     * @param {[]} landmarks array formatted like so: [x1,y1,x2,y2,x3,x3,...]
     * @param {number} start start index to draw lines
     * @param {number} end end index to draw lines
     * @param {boolean} closed whether or not to connect the start and end points of polyline
     */
    drawPolyline(landmarks, start, end, closed) {
        const overlayCtx = this.overlayCanvas.getContext('2d');
        overlayCtx.beginPath();
        overlayCtx.strokeStyle = this.data.overlayColor;
        overlayCtx.lineWidth = 1.5;

        overlayCtx.moveTo(landmarks[start][0], landmarks[start][1]);
        for (let i = start + 1; i <= end; i++) {
            overlayCtx.lineTo(landmarks[i][0], landmarks[i][1]);
        }
        if (closed) {
            overlayCtx.lineTo(landmarks[start][0], landmarks[start][1]);
        }

        overlayCtx.stroke();
    },

    /**
     * Draws face features as connected polylines
     * @param {object} features object returned by face tracker worker
     */
    drawFeatures(features) {
        if (!this.running) return;
        const { bbox } = features;
        const { landmarks } = features;

        const overlayCtx = this.overlayCanvas.getContext('2d');
        overlayCtx.clearRect(0, 0, this.width, this.height);

        const landmarksFormatted = [];
        for (let i = 0; i < landmarks.length; i += 2) {
            const l = [landmarks[i], landmarks[i + 1]];
            landmarksFormatted.push(l);
        }

        if (this.data.displayBbox) this.drawBbox(bbox);
        this.drawPolyline(landmarksFormatted, 0, 16, false); // jaw
        this.drawPolyline(landmarksFormatted, 17, 21, false); // left eyebrow
        this.drawPolyline(landmarksFormatted, 22, 26, false); // right eyebrow
        this.drawPolyline(landmarksFormatted, 27, 30, false); // nose bridge
        this.drawPolyline(landmarksFormatted, 30, 35, true); // lower nose
        this.drawPolyline(landmarksFormatted, 36, 41, true); // left eye
        this.drawPolyline(landmarksFormatted, 42, 47, true); // right Eye
        this.drawPolyline(landmarksFormatted, 48, 59, true); // outer lip
        this.drawPolyline(landmarksFormatted, 60, 67, true); // inner lip
    },

    /**
     * Checks if landmarks are valid
     * @param {[]} landmarks array formatted like so: [x1,y1,x2,y2,x3,x3,...]
     * @return {boolean} whether or not the landmarks has a valid face or not
     */
    hasFace(landmarks) {
        if (!landmarks || landmarks.length === 0) return false;

        let numZeros = 0;
        for (let i = 0; i < landmarks.length; i++) {
            // if (i % 2 == 0 && landmarks[i] > width) return false;
            // if (i % 2 == 1 && landmarks[i] > height) return false;
            if (landmarks[i] === 0) numZeros++;
        }
        return numZeros <= landmarks.length / 2;
    },

    /**
     * Creates JSON representation of face tracker output to be sent through mqtt
     * @param {boolean} hasFace whether or not features are valid
     * @param {object} landmarks landmarks
     * @param {object} bbox bbox
     * @param {object} pose rotation and translation estimation of face
     * @return {object} resulting JSON of normalized values to be sent through mqtt
     */
    createFaceJSON(hasFace, landmarks, bbox, pose) {
        const landmarksRaw = landmarks;
        const quat = pose.rotation;
        const trans = pose.translation;

        const faceJSON = {};
        faceJSON.object_id = ARENA.faceName;
        faceJSON.type = 'face-features';
        faceJSON.action = 'update';

        faceJSON.data = {};

        faceJSON.data.hasFace = hasFace;

        faceJSON.data.image = {};
        faceJSON.data.image.flipped = this.data.flipped;
        faceJSON.data.image.width = this.width;
        faceJSON.data.image.height = this.height;

        faceJSON.data.pose = {};

        let adjustedQuat;
        const quatAdjusted = [];

        adjustedQuat = hasFace ? ARENAUtils.round3(quat.x) : 0;
        quatAdjusted.push(adjustedQuat);

        adjustedQuat = hasFace ? ARENAUtils.round3(quat.y) : 0;
        quatAdjusted.push(adjustedQuat);

        adjustedQuat = hasFace ? ARENAUtils.round3(quat.z) : 0;
        quatAdjusted.push(adjustedQuat);

        adjustedQuat = hasFace ? ARENAUtils.round3(quat.w) : 0;
        quatAdjusted.push(adjustedQuat);

        faceJSON.data.pose.quaternions = quatAdjusted;

        let adjustedTrans;
        const transAdjusted = [];

        adjustedTrans = hasFace ? ARENAUtils.round3(trans.x) : 0;
        transAdjusted.push(adjustedTrans);

        adjustedTrans = hasFace ? ARENAUtils.round3(trans.y) : 0;
        transAdjusted.push(adjustedTrans);

        adjustedTrans = hasFace ? ARENAUtils.round3(trans.z) : 0;
        transAdjusted.push(adjustedTrans);

        faceJSON.data.pose.translation = transAdjusted;

        const landmarksAdjusted = [];
        for (let i = 0; i < 68 * 2; i += 2) {
            const adjustedX = hasFace ? ARENAUtils.round3((landmarksRaw[i] - this.width / 2) / this.width) : 0;
            const adjustedY = hasFace ? ARENAUtils.round3((this.height / 2 - landmarksRaw[i + 1]) / this.height) : 0;
            landmarksAdjusted.push(adjustedX);
            landmarksAdjusted.push(adjustedY);
        }
        faceJSON.data.landmarks = landmarksAdjusted;

        let adjustedX;
        let adjustedY;
        const bboxAdjusted = [];

        adjustedX = hasFace ? ARENAUtils.round3((bbox.left - this.width / 2) / this.width) : 0;
        adjustedY = hasFace ? ARENAUtils.round3((this.height / 2 - bbox.top) / this.height) : 0;
        bboxAdjusted.push(adjustedX);
        bboxAdjusted.push(adjustedY);

        adjustedX = hasFace ? ARENAUtils.round3((bbox.right - this.width / 2) / this.width) : 0;
        adjustedY = hasFace ? ARENAUtils.round3((this.height / 2 - bbox.bottom) / this.height) : 0;
        bboxAdjusted.push(adjustedX);
        bboxAdjusted.push(adjustedY);

        faceJSON.data.bbox = bboxAdjusted;

        // faceJSON['data']['frame'] = frame;

        return faceJSON;
    },

    /**
     * Stop running face tracker and stop videos and overlay
     */
    stopFaceTracking() {
        this.running = false;
        this.faceTracker.stop();
        const overlayCtx = this.overlayCanvas.getContext('2d');
        overlayCtx.clearRect(0, 0, this.width, this.height);
    },

    /**
     * Start running face tracker again
     */
    restart() {
        this.running = true;
        if (!this.initialized) {
            let cameraOptions = {};
            const perfVideoInput = localStorage.getItem('prefVideoInput');
            if (perfVideoInput) {
                cameraOptions = { deviceId: { exact: perfVideoInput } };
            }
            const shapePredURL =
                'https://arena-cdn.conix.io/store/face-tracking/shape_predictor_68_face_landmarks_compressed.dat';
            this.faceTracker.init(shapePredURL, cameraOptions);
            this.initialized = true;
        } else {
            this.faceTracker.restart();
        }
    },

    isEnabled() {
        return this.enabled;
    },

    isRunning() {
        return this.running;
    },

    run() {
        this.restart();
        return new Promise((resolve) => {
            resolve();
        });
    },

    stop() {
        this.stopFaceTracking();
        return new Promise((resolve) => {
            resolve();
        });
    },
});
