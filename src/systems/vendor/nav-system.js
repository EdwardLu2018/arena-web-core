/**
 * Monkeypatched AFRAME-extras nav system, with modifications of:
 * - pathfinding instance is in scope of system
 * - getNode allows optional param to allow non-coplanar closestNode
 */

const { Pathfinding } = require('three-pathfinding');

const ZONE = 'level';

/**
 * Pathfinding system, using PatrolJS.
 *
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 */

AFRAME.systems.nav.prototype.init = function init() {
    this.navMesh = null;
    this.agents = new Set();
    this.pathfinder = new Pathfinding();
};

/**
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 *
 * @param {THREE.Geometry} geometry
 */
AFRAME.systems.nav.prototype.setNavMeshGeometry = function setNavMeshGeometry(geometry) {
    this.navMesh = new THREE.Mesh(geometry);
    this.pathfinder.setZoneData(ZONE, Pathfinding.createZone(geometry));
    Array.from(this.agents).forEach((agent) => agent.updateNavLocation());
};

/**
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 *
 * @param  {THREE.Vector3} start
 * @param  {THREE.Vector3} end
 * @param  {number} groupID
 * @return {Array<THREE.Vector3>}
 */
AFRAME.systems.nav.prototype.getPath = function getPath(start, end, groupID) {
    return this.navMesh ? this.pathfinder.findPath(start, end, ZONE, groupID) : null;
};

/**
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 *
 * @param {THREE.Vector3} position
 * @param {boolean} checkPolygon - Check coplanar groups only
 * @return {number}
 */
AFRAME.systems.nav.prototype.getGroup = function getGroup(position, checkPolygon = true) {
    return this.navMesh ? this.pathfinder.getGroup(ZONE, position, checkPolygon) : null;
};

/**
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 *
 * @param  {THREE.Vector3} position
 * @param  {number} groupID
 * @param  {boolean} checkPolygon - Restrict getClosest node to coplanar
 * @return {Node}
 */
AFRAME.systems.nav.prototype.getNode = function getNode(position, groupID, checkPolygon = true) {
    return this.navMesh ? this.pathfinder.getClosestNode(position, ZONE, groupID, checkPolygon) : null;
};

/**
 * AFRAME Monkeypatch - AFRAME Extras Nav (src/pathfinding/system.js)
 *
 * @param  {THREE.Vector3} start Starting position.
 * @param  {THREE.Vector3} end Desired ending position.
 * @param  {number} groupID
 * @param  {Node} node
 * @param  {THREE.Vector3} endTarget (Output) Adjusted step end position.
 * @return {Node} Current node, after step is taken.
 */
AFRAME.systems.nav.prototype.clampStep = function clampStep(start, end, groupID, node, endTarget) {
    if (!this.navMesh) {
        endTarget.copy(end);
        return null;
    }
    if (!node) {
        endTarget.copy(end);
        return this.getNode(end, groupID);
    }
    return this.pathfinder.clampStep(start, end, node, ZONE, groupID, endTarget);
};
